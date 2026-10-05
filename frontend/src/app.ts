import {
  AfterViewInit,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from "@angular/core";
import { DatePipe, DecimalPipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { HttpClient } from "@angular/common/http";
import { forkJoin } from "rxjs";
import { Map, Marker, NavigationControl } from "maplibre-gl";
import ms from "milsymbol";
import type { Polygon } from "geojson";

interface Observation {
  id: string;
  layerId: string;
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  occurredAt: string;
  sidc: string;
  sourceUrl: string | null;
  sample: boolean;
  approximate: boolean;
}
interface Layer {
  id: string;
  name: string;
  color: string;
  kind: "pins" | "area";
  geometry: Polygon | null;
  sample: boolean;
}

@Component({
  selector: "vv-app",
  standalone: true,
  imports: [FormsModule, DatePipe, DecimalPipe],
  templateUrl: "./app.html",
})
export class App implements AfterViewInit, OnDestroy {
  private http = inject(HttpClient);
  events = signal<Observation[]>([]);
  layers = signal<Layer[]>([]);
  hidden = signal(new Set<string>());
  query = signal("");
  selected = signal<Observation | null>(null);
  loading = signal(true);
  error = signal("");
  mapError = signal("");
  adding = signal(false);
  saving = signal(false);
  saveError = signal("");
  notice = signal("");
  visible = computed(() =>
    this.events().filter(
      (e) =>
        !this.hidden().has(e.layerId) &&
        `${e.title} ${e.description}`
          .toLowerCase()
          .includes(this.query().toLowerCase()),
    ),
  );
  pinLayers = computed(() => this.layers().filter((l) => l.kind === "pins"));
  form = this.emptyForm();
  private map?: Map;
  private markers: Marker[] = [];
  private ready = false;
  private destroyed = false;

  private emptyForm() {
    return {
      title: "",
      description: "",
      layerId: "10000000-0000-0000-0000-000000000001",
      latitude: null as number | null,
      longitude: null as number | null,
      occurredAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16),
    };
  }

  ngAfterViewInit() {
    this.reload();
    try {
      this.map = new Map({
        container: "map",
        style: "https://tiles.openfreemap.org/styles/positron",
        center: [24.75, 59.428],
        zoom: 11.8,
        attributionControl: { compact: true },
      });
      this.map.addControl(new NavigationControl(), "bottom-right");
      this.map.on("load", () => {
        this.ready = true;
        this.mapError.set("");
        this.renderMap();
      });
      this.map.on("error", () =>
        this.mapError.set(
          "Some map data could not load. Check your internet connection; the event log is still available.",
        ),
      );
      this.map.on("click", (e) => {
        if (this.adding()) {
          this.form.latitude = +e.lngLat.lat.toFixed(6);
          this.form.longitude = +e.lngLat.lng.toFixed(6);
        }
      });
    } catch {
      this.mapError.set(
        "The map requires WebGL. The event log is still available.",
      );
    }
  }

  reload() {
    this.loading.set(true);
    this.error.set("");
    forkJoin({
      events: this.http.get<Observation[]>("/api/events"),
      layers: this.http.get<Layer[]>("/api/layers"),
    }).subscribe({
      next: (data) => {
        if (this.destroyed) return;
        this.events.set(data.events);
        this.layers.set(data.layers);
        this.loading.set(false);
        this.renderMap();
      },
      error: () => {
        this.loading.set(false);
        this.error.set(
          "Cannot connect to VV. Check that the backend and PostgreSQL are running.",
        );
      },
    });
  }

  toggle(layer: Layer) {
    const hidden = new Set(this.hidden());
    hidden.has(layer.id) ? hidden.delete(layer.id) : hidden.add(layer.id);
    this.hidden.set(hidden);
    this.refresh();
  }
  search(value: string) {
    this.query.set(value);
    this.refresh();
  }
  private refresh() {
    if (
      this.selected() &&
      !this.visible().some((e) => e.id === this.selected()?.id)
    )
      this.selected.set(null);
    this.renderMap();
  }
  select(event: Observation) {
    this.selected.set(event);
    this.map?.flyTo({ center: [event.longitude, event.latitude], zoom: 14 });
  }
  overview() {
    this.selected.set(null);
    this.map?.flyTo({ center: [24.75, 59.428], zoom: 11.8 });
  }
  openForm() {
    if (this.saving()) return;
    this.selected.set(null);
    this.form = this.emptyForm();
    this.saveError.set("");
    this.notice.set("");
    this.adding.set(true);
  }
  safeSource(url: string | null) {
    return url?.startsWith("https://") ? url : null;
  }
  save() {
    if (this.saving()) return;
    const at = new Date(this.form.occurredAt);
    if (
      !this.form.title.trim() ||
      !this.form.description.trim() ||
      this.form.latitude === null ||
      this.form.longitude === null ||
      Number.isNaN(at.getTime())
    ) {
      this.saveError.set("Add a title, description, location, and time.");
      return;
    }
    this.saving.set(true);
    this.saveError.set("");
    this.http
      .post<Observation>("/api/events", {
        ...this.form,
        occurredAt: at.toISOString(),
      })
      .subscribe({
        next: (event) => {
          this.events.update((events) =>
            [event, ...events].sort((a, b) =>
              b.occurredAt.localeCompare(a.occurredAt),
            ),
          );
          this.query.set("");
          this.hidden.update((h) => {
            const n = new Set(h);
            n.delete(event.layerId);
            return n;
          });
          this.adding.set(false);
          this.saving.set(false);
          this.renderMap();
          this.select(event);
          this.notice.set("Observation saved to PostgreSQL.");
        },
        error: () => {
          this.saving.set(false);
          this.saveError.set(
            "Could not save. Check the coordinates and backend connection, then try again.",
          );
        },
      });
  }

  private renderMap() {
    if (!this.ready || !this.map || this.destroyed) return;
    for (const layer of this.layers().filter(
      (l) => l.kind === "area" && l.geometry,
    )) {
      if (!this.map.getSource(layer.id)) {
        this.map.addSource(layer.id, {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: layer.geometry! },
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
      const visibility = this.hidden().has(layer.id) ? "none" : "visible";
      this.map.setLayoutProperty(layer.id, "visibility", visibility);
      this.map.setLayoutProperty(
        layer.id + "-outline",
        "visibility",
        visibility,
      );
    }
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    for (const event of this.visible()) {
      const button = document.createElement("button");
      button.className = "map-pin";
      button.type = "button";
      button.setAttribute("aria-label", event.title);
      const symbol = new ms.Symbol(event.sidc, { size: 25 });
      const img = document.createElement("img");
      img.src = symbol.toDataURL();
      img.alt = "";
      button.append(img);
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        this.select(event);
      });
      this.markers.push(
        new Marker({ element: button })
          .setLngLat([event.longitude, event.latitude])
          .addTo(this.map),
      );
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.markers.forEach((m) => m.remove());
    this.map?.remove();
  }
}
