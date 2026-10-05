CREATE TABLE map_layer (
    id uuid PRIMARY KEY,
    name varchar(120) NOT NULL,
    color varchar(7) NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    kind varchar(10) NOT NULL CHECK (kind IN ('pins','area')),
    geometry jsonb,
    sample boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    CHECK ((kind = 'area' AND geometry IS NOT NULL) OR (kind = 'pins' AND geometry IS NULL))
);
CREATE TABLE observation (
    id uuid PRIMARY KEY,
    layer_id uuid NOT NULL REFERENCES map_layer(id),
    title varchar(160) NOT NULL CHECK (length(trim(title)) > 0),
    description varchar(2000) NOT NULL CHECK (length(trim(description)) > 0),
    latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    occurred_at timestamptz NOT NULL,
    sidc varchar(30) NOT NULL,
    source_url text,
    sample boolean NOT NULL DEFAULT false,
    approximate boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX observation_time_idx ON observation(occurred_at DESC);
CREATE INDEX observation_layer_idx ON observation(layer_id);
INSERT INTO map_layer(id,name,color,kind,sort_order) VALUES
('10000000-0000-0000-0000-000000000001','Observations','#58bfa6','pins',0);
