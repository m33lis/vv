ALTER TABLE map_layer DROP CONSTRAINT map_layer_kind_check;
ALTER TABLE map_layer DROP CONSTRAINT map_layer_check;
ALTER TABLE map_layer ADD COLUMN visible boolean NOT NULL DEFAULT true;
ALTER TABLE map_layer ADD COLUMN opacity double precision NOT NULL DEFAULT 0.7 CHECK (opacity BETWEEN 0 AND 1);
ALTER TABLE map_layer ADD COLUMN source_key varchar(40);
ALTER TABLE map_layer ADD CONSTRAINT map_layer_kind_check CHECK (kind IN ('pins','area','objects','raster'));
ALTER TABLE map_layer ADD CONSTRAINT map_layer_geometry_check CHECK (
  (kind = 'area' AND geometry IS NOT NULL) OR (kind <> 'area' AND geometry IS NULL));
ALTER TABLE map_layer ADD CONSTRAINT map_layer_source_check CHECK (
  (kind = 'raster' AND source_key IS NOT NULL AND source_key IN ('estonia-relief','estonia-hillshade','estonia-surface'))
  OR (kind <> 'raster' AND source_key IS NULL));
CREATE TABLE map_object (
  id uuid PRIMARY KEY,
  layer_id uuid NOT NULL REFERENCES map_layer(id),
  name varchar(160) NOT NULL CHECK (length(trim(name)) > 0),
  description varchar(2000) NOT NULL DEFAULT '',
  geometry jsonb NOT NULL CHECK (geometry->>'type' IN ('Point','LineString','Polygon')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX map_object_layer_idx ON map_object(layer_id);

