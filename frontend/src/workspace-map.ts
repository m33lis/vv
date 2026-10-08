import {
  Map,
  Marker,
  NavigationControl,
  GeoJSONSource,
  LngLatBounds,
} from "maplibre-gl";
import ms from "milsymbol";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type {
  Layer,
  Observation,
  MapObject,
  Position,
  ObjectGeometry,
} from "./models";

export class WorkspaceMap {
  readonly map: Map;
  ready = false;
  private markers: Marker[] = [];
  private editing = false;
  private searchMarker?: Marker;
  private objectIds = ["vv-object-fill", "vv-object-line", "vv-object-point"];
  constructor(
    container: string,
    callbacks: {
      ready: () => void;
      error: (message: string) => void;
      click: (position: Position, objectId?: string) => void;
      context: (position: Position, x: number, y: number) => void;
      move: () => void;
    },
  ) {
    this.map = new Map({
      container,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [24.75, 59.428],
      zoom: 11.8,
      attributionControl: { compact: true },
    });
    this.map.addControl(new NavigationControl(), "bottom-right");
    this.map.dragRotate.disable();
    this.map.on("load", () => {
      this.ready = true;
      callbacks.ready();
    });
    this.map.on("error", (event) =>
      callbacks.error(
        event.error?.message?.includes("/api/tiles/")
          ? "An elevation tile could not load. Retry the overlay or hide it; saved objects are still available."
          : "Some map data could not load. Check the connection or retry the overlays.",
      ),
    );
    this.map.on("movestart", () => callbacks.move());
    this.map.on("contextmenu", (e) => {
      e.preventDefault();
      e.originalEvent.preventDefault();
      callbacks.context(
        [e.lngLat.wrap().lng, e.lngLat.lat],
        e.point.x,
        e.point.y,
      );
    });
    this.map.on("click", (e) => {
      const layers = this.objectIds.filter((id) => this.map.getLayer(id));
      const features = layers.length
        ? this.map.queryRenderedFeatures(e.point, { layers })
        : [];
      callbacks.click(
        [e.lngLat.wrap().lng, e.lngLat.lat],
        features[0]?.properties["id"],
      );
    });
  }
  searchLocation(position: Position | null, label = "") {
    this.searchMarker?.remove();
    this.searchMarker = undefined;
    if (!position) return;
    const element = document.createElement("div");
    element.className = "address-marker";
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", label);
    element.title = label;
    this.searchMarker = new Marker({ element })
      .setLngLat(position)
      .addTo(this.map);
  }
  centre(): Position {
    const p = this.map.getCenter();
    return [p.wrap().lng, p.lat];
  }
  focus(position: Position) {
    this.map.flyTo({ center: position, zoom: 14 });
  }
  focusObject(object: MapObject) {
    if (object.geometry.type === "Point") {
      this.focus(object.geometry.coordinates as Position);
      return;
    }
    const positions =
      object.geometry.type === "Polygon"
        ? object.geometry.coordinates[0]
        : object.geometry.coordinates;
    const bounds = new LngLatBounds();
    positions.forEach((p) => bounds.extend(p as Position));
    this.map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
  }
  overview() {
    this.map.flyTo({ center: [24.75, 59.428], zoom: 11.8 });
  }
  drawing(active: boolean) {
    this.editing = active;
    this.markers.forEach(
      (m) => (m.getElement().style.pointerEvents = active ? "none" : "auto"),
    );
    this.map.getCanvas().style.cursor = active ? "crosshair" : "";
    active
      ? this.map.doubleClickZoom.disable()
      : this.map.doubleClickZoom.enable();
  }
  render(
    layers: Layer[],
    events: Observation[],
    objects: MapObject[],
    select: (event: Observation) => void,
  ) {
    if (!this.ready) return;
    for (const layer of layers) {
      if (layer.kind === "raster") {
        if (!this.map.getSource(layer.id) && layer.visible) {
          this.map.addSource(layer.id, {
            type: "raster",
            tiles: [
              `${location.origin}/api/tiles/${layer.sourceKey}/{z}/{x}/{y}.png`,
            ],
            tileSize: 256,
            minzoom: 6,
            maxzoom: 17,
            bounds: [19.4, 57.1, 30.7, 60.4],
            attribution:
              'Elevation: <a href="https://maaruum.ee/">Maa- ja Ruumiamet</a>',
          });
          const before = this.map
            .getStyle()
            .layers?.find((l) => l.type === "symbol")?.id;
          this.map.addLayer(
            {
              id: layer.id,
              type: "raster",
              source: layer.id,
              paint: { "raster-opacity": layer.opacity },
            },
            before,
          );
        }
        if (this.map.getLayer(layer.id)) {
          this.map.setLayoutProperty(
            layer.id,
            "visibility",
            layer.visible ? "visible" : "none",
          );
          this.map.setPaintProperty(layer.id, "raster-opacity", layer.opacity);
        }
      } else if (layer.kind === "area" && layer.geometry) {
        if (!this.map.getSource(layer.id)) {
          this.map.addSource(layer.id, {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: layer.geometry },
          });
          this.map.addLayer({
            id: layer.id,
            type: "fill",
            source: layer.id,
            paint: { "fill-color": layer.color, "fill-opacity": 0.12 },
          });
          this.map.addLayer({
            id: layer.id + "-outline",
            type: "line",
            source: layer.id,
            paint: {
              "line-color": layer.color,
              "line-width": 2,
              "line-dasharray": [3, 3],
            },
          });
        }
        for (const id of [layer.id, layer.id + "-outline"])
          this.map.setLayoutProperty(
            id,
            "visibility",
            layer.visible ? "visible" : "none",
          );
      }
    }
    const data: FeatureCollection = {
      type: "FeatureCollection",
      features: objects.map((object) => ({
        type: "Feature",
        properties: {
          id: object.id,
          name: object.name,
          color:
            layers.find((l) => l.id === object.layerId)?.color ?? "#58bfa6",
        },
        geometry: object.geometry,
      })),
    };
    if (!this.map.getSource("vv-objects")) {
      this.map.addSource("vv-objects", { type: "geojson", data });
      this.map.addLayer({
        id: "vv-object-fill",
        type: "fill",
        source: "vv-objects",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.25 },
      });
      this.map.addLayer({
        id: "vv-object-line",
        type: "line",
        source: "vv-objects",
        filter: ["!=", ["geometry-type"], "Point"],
        paint: { "line-color": ["get", "color"], "line-width": 3 },
      });
      this.map.addLayer({
        id: "vv-object-point",
        type: "circle",
        source: "vv-objects",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": 8,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#fff",
        },
      });
      this.map.addLayer({
        id: "vv-object-label",
        type: "symbol",
        source: "vv-objects",
        filter: ["==", ["geometry-type"], "Point"],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-anchor": "top",
          "text-offset": [0, 1.1],
        },
        paint: {
          "text-color": "#143829",
          "text-halo-color": "#fff",
          "text-halo-width": 2,
        },
      });
    } else (this.map.getSource("vv-objects") as GeoJSONSource).setData(data);
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    for (const event of events) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-pin";
      button.style.pointerEvents = this.editing ? "none" : "auto";
      button.setAttribute("aria-label", event.title);
      const image = document.createElement("img");
      image.src = new ms.Symbol(event.sidc, { size: 25 }).toDataURL();
      image.alt = "";
      button.append(image);
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        select(event);
      });
      this.markers.push(
        new Marker({ element: button })
          .setLngLat([event.longitude, event.latitude])
          .addTo(this.map),
      );
    }
  }
  draft(geometry: ObjectGeometry | null, vertices: Position[]) {
    if (!this.ready) return;
    const features: Feature<Geometry>[] = [];
    if (geometry) features.push({ type: "Feature", properties: {}, geometry });
    vertices.forEach((p) =>
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: p },
      }),
    );
    const data: FeatureCollection = { type: "FeatureCollection", features };
    if (!this.map.getSource("vv-draft")) {
      this.map.addSource("vv-draft", { type: "geojson", data });
      this.map.addLayer({
        id: "vv-draft-fill",
        type: "fill",
        source: "vv-draft",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#f2ae43", "fill-opacity": 0.22 },
      });
      this.map.addLayer({
        id: "vv-draft-line",
        type: "line",
        source: "vv-draft",
        filter: ["!=", ["geometry-type"], "Point"],
        paint: {
          "line-color": "#d38419",
          "line-width": 3,
          "line-dasharray": [2, 2],
        },
      });
      this.map.addLayer({
        id: "vv-draft-point",
        type: "circle",
        source: "vv-draft",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": "#f2ae43",
          "circle-radius": 6,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });
    } else (this.map.getSource("vv-draft") as GeoJSONSource).setData(data);
    for (const id of ["vv-draft-fill", "vv-draft-line", "vv-draft-point"])
      this.map.moveLayer(id);
  }
  removeLayer(id: string) {
    if (!this.ready) return;
    for (const layerId of [id + "-outline", id]) {
      if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
    }
    if (this.map.getSource(id)) this.map.removeSource(id);
  }
  retryExternal(layers: Layer[]) {
    for (const l of layers.filter((l) => l.kind === "raster")) {
      if (this.map.getLayer(l.id)) this.map.removeLayer(l.id);
      if (this.map.getSource(l.id)) this.map.removeSource(l.id);
    }
  }
  destroy() {
    this.searchMarker?.remove();
    this.markers.forEach((m) => m.remove());
    this.map.remove();
  }
}
