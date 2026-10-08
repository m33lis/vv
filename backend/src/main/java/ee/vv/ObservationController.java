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
public class ObservationController {
    private final JdbcClient db;
    private final ObjectMapper json;
    public ObservationController(JdbcClient db, ObjectMapper json) { this.db = db; this.json = json; }

    public record Event(UUID id, UUID layerId, String title, String description, double latitude,
                        double longitude, Instant occurredAt, String sidc, String sourceUrl,
                        boolean sample, boolean approximate) {}
    public record Layer(UUID id, String name, String color, String kind, JsonNode geometry, boolean sample,
                        boolean visible, double opacity, String sourceKey) {}
    public record NewEvent(@NotNull UUID layerId, @NotBlank @Size(max=160) String title,
                           @NotBlank @Size(max=2000) String description,
                           @NotNull @DecimalMin("-90") @DecimalMax("90") Double latitude,
                           @NotNull @DecimalMin("-180") @DecimalMax("180") Double longitude,
                           @NotNull Instant occurredAt) {}

    @GetMapping("/events")
    public List<Event> events() {
        return db.sql("SELECT * FROM observation ORDER BY occurred_at DESC, id").query((r, n) ->
            new Event(r.getObject("id", UUID.class), r.getObject("layer_id", UUID.class),
                r.getString("title"), r.getString("description"), r.getDouble("latitude"),
                r.getDouble("longitude"), r.getTimestamp("occurred_at").toInstant(), r.getString("sidc"),
                r.getString("source_url"), r.getBoolean("sample"), r.getBoolean("approximate"))).list();
    }

    @GetMapping("/layers")
    public List<Layer> layers() {
        return db.sql("SELECT * FROM map_layer ORDER BY sort_order, name").query((r, n) -> {
            String geometry = r.getString("geometry");
            return new Layer(r.getObject("id", UUID.class), r.getString("name"), r.getString("color"),
                r.getString("kind"), geometry == null ? null : json.readTree(geometry), r.getBoolean("sample"),
                r.getBoolean("visible"), r.getDouble("opacity"), r.getString("source_key"));
        }).list();
    }

    @PostMapping("/events")
    @ResponseStatus(HttpStatus.CREATED)
    public Event create(@Valid @RequestBody NewEvent input) {
        boolean exists = db.sql("SELECT count(*) FROM map_layer WHERE id = :id AND kind IN ('pins','objects')")
            .param("id", input.layerId()).query(Integer.class).single() > 0;
        if (!exists) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose an existing pin layer");
        UUID id = UUID.randomUUID();
        String sidc = "SNGP-----------";
        db.sql("""
            INSERT INTO observation(id,layer_id,title,description,latitude,longitude,occurred_at,sidc,sample,approximate)
            VALUES (:id,:layer,:title,:description,:lat,:lon,:at,:sidc,false,false)
            """)
            .param("id", id).param("layer", input.layerId()).param("title", input.title().strip())
            .param("description", input.description().strip()).param("lat", input.latitude())
            .param("lon", input.longitude()).param("at", java.sql.Timestamp.from(input.occurredAt()))
            .param("sidc", sidc).update();
        return new Event(id,input.layerId(),input.title().strip(),input.description().strip(),
            input.latitude(),input.longitude(),input.occurredAt(),sidc,null,false,false);
    }
    @PutMapping("/events/{id}")
    @org.springframework.transaction.annotation.Transactional
    public Event update(@PathVariable UUID id, @Valid @RequestBody NewEvent input) {
        if (db.sql("SELECT count(*) FROM map_layer WHERE id=:id AND kind IN ('pins','objects')")
            .param("id",input.layerId()).query(Integer.class).single()==0)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Choose an event or object layer");
        if (db.sql("""
            UPDATE observation SET layer_id=:layer,title=:title,description=:description,
                latitude=:lat,longitude=:lon,occurred_at=:at WHERE id=:id
            """).param("id",id).param("layer",input.layerId()).param("title",input.title().strip())
            .param("description",input.description().strip()).param("lat",input.latitude())
            .param("lon",input.longitude()).param("at",java.sql.Timestamp.from(input.occurredAt())).update()==0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Event not found");
        return events().stream().filter(e->e.id().equals(id)).findFirst().orElseThrow();
    }}

