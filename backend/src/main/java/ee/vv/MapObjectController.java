package ee.vv;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class MapObjectController {
    private final JdbcClient db;
    private final ObjectMapper json;
    private final ObservationController observations;
    public MapObjectController(JdbcClient db, ObjectMapper json, ObservationController observations) {
        this.db=db; this.json=json; this.observations=observations;
    }
    public record NewLayer(@NotBlank @Size(max=120) String name,
                           @NotNull @Pattern(regexp="#[0-9a-fA-F]{6}") String color, String sourceKey) {}
    public record LayerSettings(@NotNull Boolean visible, @NotNull @DecimalMin("0") @DecimalMax("1") Double opacity) {}
    public record MapObject(UUID id, UUID layerId, String name, String description, JsonNode geometry, Instant createdAt) {}
    public record NewObject(@NotNull UUID layerId, @NotBlank @Size(max=160) String name,
                            @NotNull @Size(max=2000) String description, @NotNull JsonNode geometry) {}

    @PostMapping("/layers") @ResponseStatus(HttpStatus.CREATED)
    public ObservationController.Layer createLayer(@Valid @RequestBody NewLayer input) {
        if (input.sourceKey()!=null) ExternalMapController.source(input.sourceKey());
        UUID id=UUID.randomUUID();
        db.sql("INSERT INTO map_layer(id,name,color,kind,source_key,sort_order) VALUES (:id,:name,:color,:kind,:source,10)")
            .param("id",id).param("name",input.name().strip()).param("color",input.color())
            .param("kind",input.sourceKey()==null ? "objects":"raster")
            .param("source",input.sourceKey(),java.sql.Types.VARCHAR).update();
        return layer(id);
    }
    @PatchMapping("/layers/{id}")
    public ObservationController.Layer settings(@PathVariable UUID id, @Valid @RequestBody LayerSettings settings) {
        if(db.sql("UPDATE map_layer SET visible=:visible,opacity=:opacity WHERE id=:id")
            .param("id",id).param("visible",settings.visible()).param("opacity",settings.opacity()).update()==0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Layer not found");
        return layer(id);
    }
    @DeleteMapping("/layers/{id}") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteLayer(@PathVariable UUID id) {
        // Foreign keys cascade within this single atomic statement.
        if (db.sql("DELETE FROM map_layer WHERE id=:id").param("id",id).update()==0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Layer not found");
    }
    private ObservationController.Layer layer(UUID id) {
        return observations.layers().stream().filter(l->l.id().equals(id)).findFirst().orElseThrow();
    }
    @GetMapping("/objects")
    public List<MapObject> objects() {
        return db.sql("SELECT * FROM map_object ORDER BY created_at, id").query((r,n)->new MapObject(
            r.getObject("id",UUID.class),r.getObject("layer_id",UUID.class),r.getString("name"),
            r.getString("description"),json.readTree(r.getString("geometry")),r.getTimestamp("created_at").toInstant())).list();
    }
    @PostMapping("/objects") @ResponseStatus(HttpStatus.CREATED)
    public MapObject createObject(@Valid @RequestBody NewObject input) {
        GeometryValidator.validate(input.geometry());
        if(db.sql("SELECT count(*) FROM map_layer WHERE id=:id AND kind='objects'")
            .param("id",input.layerId()).query(Integer.class).single()==0)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Choose an object layer");
        UUID id=UUID.randomUUID();
        Instant now=Instant.now();
        db.sql("""
            INSERT INTO map_object(id,layer_id,name,description,geometry,created_at)
            VALUES (:id,:layer,:name,:description,CAST(:geometry AS jsonb),:created)
            """).param("id",id).param("layer",input.layerId()).param("name",input.name().strip())
            .param("description",input.description().strip()).param("geometry",json.writeValueAsString(input.geometry()))
            .param("created",java.sql.Timestamp.from(now)).update();
        return new MapObject(id,input.layerId(),input.name().strip(),input.description().strip(),input.geometry(),now);
    }
    @PutMapping("/objects/{id}")
    @org.springframework.transaction.annotation.Transactional
    public MapObject updateObject(@PathVariable UUID id, @Valid @RequestBody NewObject input) {
        GeometryValidator.validate(input.geometry());
        if (db.sql("SELECT count(*) FROM map_layer WHERE id=:id AND kind='objects'")
            .param("id",input.layerId()).query(Integer.class).single()==0)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Choose an object layer");
        if (db.sql("""
            UPDATE map_object SET layer_id=:layer,name=:name,description=:description,
                geometry=CAST(:geometry AS jsonb) WHERE id=:id
            """).param("id",id).param("layer",input.layerId()).param("name",input.name().strip())
            .param("description",input.description().strip()).param("geometry",json.writeValueAsString(input.geometry())).update()==0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Object not found");
        return objects().stream().filter(o->o.id().equals(id)).findFirst().orElseThrow();
    }}

