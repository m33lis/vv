ALTER TABLE observation DROP CONSTRAINT observation_layer_id_fkey;
ALTER TABLE observation ADD CONSTRAINT observation_layer_id_fkey
    FOREIGN KEY (layer_id) REFERENCES map_layer(id) ON DELETE CASCADE;
ALTER TABLE map_object DROP CONSTRAINT map_object_layer_id_fkey;
ALTER TABLE map_object ADD CONSTRAINT map_object_layer_id_fkey
    FOREIGN KEY (layer_id) REFERENCES map_layer(id) ON DELETE CASCADE;
