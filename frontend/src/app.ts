import {
  AfterViewInit,
  Component,
  OnDestroy,
  HostListener,
  computed,
  inject,
  signal,
} from "@angular/core";
import { DatePipe, DecimalPipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { forkJoin } from "rxjs";
import type {
  Observation,
  Layer,
  MapObject,
  ExternalSource,
  Position,
  ShapeKind,
  ObjectGeometry,
} from "./models";
import { WorkspaceMap } from "./workspace-map";

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
  objects = signal<MapObject[]>([]);
  sources = signal<ExternalSource[]>([]);
  query = signal("");
  selected = signal<Observation | null>(null);
  selectedObject = signal<MapObject | null>(null);
  editingEventId = signal<string | null>(null);
  editingObjectId = signal<string | null>(null);
  vertexIndex = 0;
  loading = signal(true);
  error = signal("");
  mapError = signal("");
  notice = signal("");
  adding = signal(false);
  objectEditing = signal(false);
  drawing = signal(false);
  saving = signal(false);
  saveError = signal("");
  layerEditor = signal(false);
  layerSaving = signal(false);
  layerError = signal("");
  deletingLayer = signal<string | null>(null);
  pendingLayers = signal(new Set<string>());
  logMode = signal<"events" | "objects">("events");
  context = signal<{ position: Position; x: number; y: number } | null>(null);
  vertices = signal<Position[]>([]);
  layerForm = { name: "", color: "#58bfa6", sourceKey: "" };
  layerType: "objects" | "raster" = "objects";
  form = this.emptyForm();
  objectForm = {
    name: "",
    description: "",
    layerId: "",
    kind: "Point" as ShapeKind,
    latitude: null as number | null,
    longitude: null as number | null,
  };
  private workspace?: WorkspaceMap;
  private destroyed = false;
  objectLayers = computed(() =>
    this.layers().filter((l) => l.kind === "objects"),
  );
  pinLayers = computed(() =>
    this.layers().filter((l) => l.kind === "pins" || l.kind === "objects"),
  );
  visible = computed(() =>
    this.events().filter(
      (e) => this.isVisible(e.layerId) && this.matches(e.title, e.description),
    ),
  );
  visibleObjects = computed(() =>
    this.objects().filter(
      (o) => this.isVisible(o.layerId) && this.matches(o.name, o.description),
    ),
  );
  canFinish() {
    return (
      this.vertices().length >= (this.objectForm.kind === "Polygon" ? 3 : 2)
    );
  }
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
  private matches(name: string, description: string) {
    return `${name} ${description}`
      .toLowerCase()
      .includes(this.query().trim().toLowerCase());
  }
  isVisible(id: string) {
    return this.layers().some((l) => l.id === id && l.visible);
  }
  layerName(id: string) {
    return this.layers().find((l) => l.id === id)?.name ?? "Layer";
  }
  sourceInfo(key: string | null) {
    return this.sources().find((s) => s.key === key);
  }
  countObjects(id: string) {
    return this.objects().filter((o) => o.layerId === id).length;
  }
  ngAfterViewInit() {
    this.reload();
    try {
      this.workspace = new WorkspaceMap("map", {
        ready: () => {
          this.mapError.set("");
          this.renderMap();
          this.renderDraft();
        },
        error: (m) => this.mapError.set(m),
        move: () => this.context.set(null),
        click: (position, id) => this.mapClick(position, id),
        context: (position, x, y) => {
          if (this.saving() || this.objectEditing() || this.adding()) return;
          const container = document.getElementById("map")!;
          this.context.set({
            position,
            x: Math.max(8, Math.min(x, container.clientWidth - 236)),
            y: Math.max(8, Math.min(y, container.clientHeight - 160)),
          });
          setTimeout(() => document.getElementById("context-event")?.focus());
        },
      });
    } catch {
      this.mapError.set("The map requires WebGL. The lists remain available.");
    }
  }
  @HostListener("document:keydown.escape") escape() {
    if (this.context()) {
      this.context.set(null);
      return;
    }
    if (!this.saving()) this.cancelEditor();
  }
  @HostListener("document:click", ["$event"]) outside(event: MouseEvent) {
    if (!(event.target as HTMLElement)?.closest(".context-menu"))
      this.context.set(null);
  }
  reload() {
    this.loading.set(true);
    this.error.set("");
    forkJoin({
      events: this.http.get<Observation[]>("/api/events"),
      layers: this.http.get<Layer[]>("/api/layers"),
      objects: this.http.get<MapObject[]>("/api/objects"),
      sources: this.http.get<ExternalSource[]>("/api/sources"),
    }).subscribe({
      next: (d) => {
        if (this.destroyed) return;
        this.events.set(d.events);
        this.layers.set(d.layers);
        this.objects.set(d.objects);
        this.sources.set(d.sources);
        this.loading.set(false);
        this.renderMap();
      },
      error: () => {
        this.loading.set(false);
        this.error.set(
          "Cannot connect to VV. Check the backend and PostgreSQL, then retry.",
        );
      },
    });
  }
  countEvents(id: string) {
    return this.events().filter((e) => e.layerId === id).length;
  }
  deleteLayer(layer: Layer) {
    if (
      this.pendingLayers().has(layer.id) ||
      this.adding() ||
      this.objectEditing() ||
      this.saving()
    )
      return;
    this.pendingLayers.update((p) => new Set(p).add(layer.id));
    this.layerError.set("");
    this.http.delete<void>(`/api/layers/${layer.id}`).subscribe({
      next: () => {
        this.workspace?.removeLayer(layer.id);
        this.layers.update((ls) => ls.filter((l) => l.id !== layer.id));
        this.events.update((es) => es.filter((e) => e.layerId !== layer.id));
        this.objects.update((os) => os.filter((o) => o.layerId !== layer.id));
        this.deletingLayer.set(null);
        this.finishLayerUpdate(layer.id);
        this.refresh();
        this.notice.set(`Layer “${layer.name}” deleted.`);
      },
      error: (e) => {
        this.finishLayerUpdate(layer.id);
        this.layerError.set(
          this.message(e, "Could not delete the layer. Try again."),
        );
      },
    });
  }
  toggle(layer: Layer) {
    this.updateLayer(layer, !layer.visible, layer.opacity);
  }
  opacity(layer: Layer, value: string) {
    this.updateLayer(layer, layer.visible, Number(value));
  }
  private updateLayer(layer: Layer, visible: boolean, opacity: number) {
    if (this.pendingLayers().has(layer.id)) return;
    this.pendingLayers.update((p) => new Set(p).add(layer.id));
    this.layerError.set("");
    this.layers.update((ls) =>
      ls.map((l) => (l.id === layer.id ? { ...l, visible, opacity } : l)),
    );
    this.refresh();
    this.http
      .patch<Layer>(`/api/layers/${layer.id}`, { visible, opacity })
      .subscribe({
        next: (result) => {
          this.layers.update((ls) =>
            ls.map((l) => (l.id === result.id ? result : l)),
          );
          this.finishLayerUpdate(layer.id);
        },
        error: () => {
          this.layers.update((ls) =>
            ls.map((l) => (l.id === layer.id ? layer : l)),
          );
          this.finishLayerUpdate(layer.id);
          this.layerError.set(
            "Could not save layer settings. The previous setting has been restored.",
          );
          this.renderMap();
        },
      });
  }
  private finishLayerUpdate(id: string) {
    this.pendingLayers.update((p) => {
      const next = new Set(p);
      next.delete(id);
      return next;
    });
  }
  openLayerEditor() {
    this.layerEditor.set(true);
    this.layerError.set("");
  }
  createLayer() {
    if (this.layerSaving()) return;
    this.layerSaving.set(true);
    this.layerError.set("");
    this.http
      .post<Layer>("/api/layers", {
        name: this.layerForm.name,
        color: this.layerForm.color,
        sourceKey:
          this.layerType === "raster" ? this.layerForm.sourceKey : null,
      })
      .subscribe({
        next: (l) => {
          this.layers.update((ls) => [...ls, l]);
          if (l.kind === "objects") {
            this.objectForm.layerId = l.id;
            if (!this.form.layerId) this.form.layerId = l.id;
          }
          this.layerSaving.set(false);
          this.layerEditor.set(false);
          this.layerForm = { name: "", color: "#58bfa6", sourceKey: "" };
          this.notice.set(`Layer “${l.name}” saved.`);
          this.renderMap();
        },
        error: (e) => {
          this.layerSaving.set(false);
          this.layerError.set(this.message(e, "Could not create the layer."));
        },
      });
  }
  chooseSource(key: string) {
    this.layerForm.sourceKey = key;
    const source = this.sourceInfo(key);
    if (source) this.layerForm.name = source.name;
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
    if (
      this.selectedObject() &&
      !this.visibleObjects().some((o) => o.id === this.selectedObject()?.id)
    )
      this.selectedObject.set(null);
    this.renderMap();
  }
  select(event: Observation) {
    if (this.adding() || this.objectEditing()) return;
    this.selectedObject.set(null);
    this.selected.set(event);
    this.workspace?.focus([event.longitude, event.latitude]);
  }
  selectObject(object: MapObject) {
    if (this.adding() || this.objectEditing()) return;
    this.selected.set(null);
    this.selectedObject.set(object);
    this.workspace?.focusObject(object);
  }
  overview() {
    this.selected.set(null);
    this.selectedObject.set(null);
    this.workspace?.overview();
  }
  editEvent(event: Observation) {
    this.openForm([event.longitude, event.latitude]);
    this.editingEventId.set(event.id);
    const at = new Date(event.occurredAt);
    this.form = {
      title: event.title,
      description: event.description,
      layerId: event.layerId,
      latitude: event.latitude,
      longitude: event.longitude,
      occurredAt: new Date(at.getTime() - at.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, -1),
    };
    this.renderMap();
    this.renderDraft();
  }
  editObject(object: MapObject) {
    this.openObject();
    this.editingObjectId.set(object.id);
    const geometry = structuredClone(object.geometry);
    const points =
      geometry.type === "Point"
        ? [geometry.coordinates]
        : geometry.type === "Polygon"
          ? geometry.coordinates[0].slice(0, -1)
          : geometry.coordinates;
    this.vertices.set(points.map((p) => [p[0], p[1]]));
    this.vertexIndex = 0;
    this.objectForm = {
      name: object.name,
      description: object.description,
      layerId: object.layerId,
      kind: geometry.type,
      longitude: points[0][0],
      latitude: points[0][1],
    };
    this.workspace?.drawing(geometry.type === "Point");
    this.renderMap();
    this.renderDraft();
  }
  moveVertex(axis: 0 | 1, value: number | null) {
    if (
      value === null ||
      !Number.isFinite(value) ||
      Math.abs(value) > (axis === 0 ? 180 : 90)
    )
      return;
    this.vertices.update((points) =>
      points.map((p, i) => {
        const copy: Position = [...p];
        if (i === this.vertexIndex) copy[axis] = value;
        return copy;
      }),
    );
    this.renderDraft();
  }
  redrawShape() {
    this.vertices.set([]);
    this.vertexIndex = 0;
    this.continueShape();
    this.renderDraft();
  }
  openForm(position?: Position) {
    if (this.saving() || this.objectEditing()) return;
    this.cancelEditor();
    this.form = this.emptyForm();
    this.form.layerId = this.pinLayers()[0]?.id ?? "";
    this.saveError.set("");
    this.notice.set("");
    if (position) {
      this.form.longitude = +position[0].toFixed(6);
      this.form.latitude = +position[1].toFixed(6);
    }
    this.adding.set(true);
    this.workspace?.drawing(true);
    this.renderDraft();
  }
  eventHere() {
    const context = this.context();
    if (context) this.openForm(context.position);
  }
  objectHere() {
    const context = this.context();
    if (context) this.openObject(context.position);
  }
  openObject(position?: Position) {
    if (this.saving() || this.adding()) return;
    this.cancelEditor();
    const p = position ?? this.workspace?.centre() ?? [24.75, 59.428];
    this.objectForm = {
      name: "",
      description: "",
      layerId: this.objectLayers()[0]?.id ?? "",
      kind: "Point",
      latitude: +p[1].toFixed(6),
      longitude: +p[0].toFixed(6),
    };
    this.vertices.set([p]);
    this.objectEditing.set(true);
    this.saveError.set("");
    this.notice.set("");
    this.workspace?.drawing(true);
    this.renderDraft();
  }
  changeShape(kind: ShapeKind) {
    if (this.objectForm.kind === "Point") {
      const p = this.geometry();
      if (p?.type === "Point")
        this.vertices.set([[p.coordinates[0], p.coordinates[1]]]);
    }
    this.objectForm.kind = kind;
    this.vertices.set(this.vertices().slice(0, 1));
    this.drawing.set(kind !== "Point");
    this.workspace?.drawing(true);
    this.saveError.set("");
    this.renderDraft();
  }
  private mapClick(position: Position, id?: string) {
    this.context.set(null);
    if (this.saving()) return;
    if (this.adding()) {
      this.form.longitude = +position[0].toFixed(6);
      this.form.latitude = +position[1].toFixed(6);
      this.renderDraft();
      return;
    }
    if (this.objectEditing()) {
      if (this.objectForm.kind === "Point") {
        this.objectForm.longitude = +position[0].toFixed(6);
        this.objectForm.latitude = +position[1].toFixed(6);
        this.vertices.set([position]);
      } else if (this.drawing()) {
        if (this.vertices().length >= 999) {
          this.saveError.set("Use fewer than 1000 corners.");
          return;
        }
        const previous = this.vertices().at(-1);
        if (
          !previous ||
          previous[0] !== position[0] ||
          previous[1] !== position[1]
        )
          this.vertices.update((v) => [...v, position]);
      }
      this.renderDraft();
      return;
    }
    if (id) {
      const object = this.objects().find((o) => o.id === id);
      if (object) this.selectObject(object);
    }
  }
  undoVertex() {
    this.vertices.update((v) => v.slice(0, -1));
    this.drawing.set(true);
    this.workspace?.drawing(true);
    this.renderDraft();
  }
  finishShape() {
    if (this.canFinish()) {
      this.drawing.set(false);
      this.workspace?.drawing(false);
      this.renderDraft();
    }
  }
  continueShape() {
    this.drawing.set(true);
    this.workspace?.drawing(true);
  }
  geometry(): ObjectGeometry | null {
    if (this.objectForm.kind === "Point") {
      const { latitude: lat, longitude: lon } = this.objectForm;
      return lat !== null &&
        lon !== null &&
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180
        ? { type: "Point", coordinates: [lon, lat] }
        : null;
    }
    const v = this.vertices();
    if (this.objectForm.kind === "LineString")
      return v.length >= 2 ? { type: "LineString", coordinates: v } : null;
    return v.length >= 3
      ? { type: "Polygon", coordinates: [[...v, v[0]]] }
      : null;
  }
  renderDraft() {
    if (this.adding()) {
      const { latitude: lat, longitude: lon } = this.form;
      this.workspace?.draft(
        lat !== null &&
          lon !== null &&
          Math.abs(lat) <= 90 &&
          Math.abs(lon) <= 180
          ? { type: "Point", coordinates: [lon, lat] }
          : null,
        [],
      );
      return;
    }
    if (this.objectEditing()) {
      let geometry = this.geometry();
      if (!geometry && this.vertices().length >= 2)
        geometry = { type: "LineString", coordinates: this.vertices() };
      this.workspace?.draft(
        geometry,
        this.objectForm.kind === "Point" ? [] : this.vertices(),
      );
    } else this.workspace?.draft(null, []);
  }
  cancelEditor() {
    if (this.saving()) return;
    this.context.set(null);
    this.editingEventId.set(null);
    this.editingObjectId.set(null);
    this.adding.set(false);
    this.objectEditing.set(false);
    this.drawing.set(false);
    this.vertices.set([]);
    this.selected.set(null);
    this.selectedObject.set(null);
    this.workspace?.drawing(false);
    this.renderMap();
    this.renderDraft();
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
      .request<Observation>(
        this.editingEventId() ? "PUT" : "POST",
        this.editingEventId()
          ? `/api/events/${this.editingEventId()}`
          : "/api/events",
        {
          body: {
            ...this.form,
            occurredAt: at.toISOString(),
          },
        },
      )
      .subscribe({
        next: (event) => {
          this.events.update((es) =>
            [event, ...es.filter((e) => e.id !== event.id)].sort((a, b) =>
              b.occurredAt.localeCompare(a.occurredAt),
            ),
          );
          this.saving.set(false);
          this.cancelEditor();
          this.query.set("");
          this.logMode.set("events");
          this.showSavedLayer(event.layerId);
          this.renderMap();
          this.select(event);
          this.notice.set("Event saved.");
        },
        error: (e) => {
          this.saving.set(false);
          this.saveError.set(
            this.message(
              e,
              "Could not save the event. Check the connection and try again.",
            ),
          );
        },
      });
  }
  saveObject() {
    const geometry = this.geometry();
    if (this.saving() || !geometry || this.drawing()) return;
    this.saving.set(true);
    this.saveError.set("");
    this.http
      .request<MapObject>(
        this.editingObjectId() ? "PUT" : "POST",
        this.editingObjectId()
          ? `/api/objects/${this.editingObjectId()}`
          : "/api/objects",
        {
          body: {
            name: this.objectForm.name,
            description: this.objectForm.description,
            layerId: this.objectForm.layerId,
            geometry,
          },
        },
      )
      .subscribe({
        next: (object) => {
          this.objects.update((os) =>
            os.some((o) => o.id === object.id)
              ? os.map((o) => (o.id === object.id ? object : o))
              : [...os, object],
          );
          this.saving.set(false);
          this.cancelEditor();
          this.query.set("");
          this.logMode.set("objects");
          this.showSavedLayer(object.layerId);
          this.renderMap();
          this.selectObject(object);
          this.notice.set("Map object saved.");
        },
        error: (e) => {
          this.saving.set(false);
          this.saveError.set(
            this.message(
              e,
              "Could not save the object. Check the boundary and connection, then try again.",
            ),
          );
        },
      });
  }
  private showSavedLayer(id: string) {
    const layer = this.layers().find((l) => l.id === id);
    if (layer && !layer.visible) this.updateLayer(layer, true, layer.opacity);
  }
  private message(error: HttpErrorResponse, fallback: string) {
    return error.error?.detail ?? fallback;
  }
  private renderMap() {
    this.workspace?.render(
      this.layers(),
      this.visible().filter((e) => e.id !== this.editingEventId()),
      this.visibleObjects().filter((o) => o.id !== this.editingObjectId()),
      (e) => this.select(e),
    );
  }
  retryMap() {
    this.mapError.set("");
    this.workspace?.retryExternal(this.layers());
    this.renderMap();
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.workspace?.destroy();
  }
}
