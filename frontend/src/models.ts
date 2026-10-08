import type { Point, LineString, Polygon } from "geojson";
export type ObjectGeometry = Point | LineString | Polygon;
export type ShapeKind = ObjectGeometry["type"];
export type Position = [number, number];
export interface Observation {
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
export interface Layer {
  id: string;
  name: string;
  color: string;
  kind: "pins" | "area" | "objects" | "raster";
  geometry: Polygon | null;
  sample: boolean;
  visible: boolean;
  opacity: number;
  sourceKey: string | null;
}
export interface MapObject {
  id: string;
  layerId: string;
  name: string;
  description: string;
  geometry: ObjectGeometry;
  createdAt: string;
}
export interface ExternalSource {
  key: string;
  name: string;
  description: string;
  attribution: string;
  infoUrl: string;
}
