package ee.vv;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.*;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

// Uses real PostgreSQL, including Flyway migrations and JSONB. Local database must be running.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "spring.flyway.schemas=vv_test", "spring.flyway.default-schema=vv_test", "spring.datasource.hikari.schema=vv_test"
})
@ActiveProfiles("demo")
class ObservationIntegrationTest {
    @Value("${local.server.port}") int port;
    @Autowired JdbcClient db;
    @Autowired ObjectMapper json;
    final HttpClient client = HttpClient.newHttpClient();
    String body(String layer, String latitude) { return """
        {"layerId":"%s","title":"Integration test","description":"Temporary verification record",
         "latitude":%s,"longitude":24.75,"occurredAt":"2026-10-04T10:00:00Z"}
        """.formatted(layer,latitude); }
    HttpResponse<String> post(String body) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/events"))
            .header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    @Test void savesAndReturnsPersistentObservation() throws Exception {
        var response=post(body("10000000-0000-0000-0000-000000000001","59.43"));
        assertThat(response.statusCode()).isEqualTo(201);
        UUID id=UUID.fromString(json.readTree(response.body()).get("id").asText());
        try {
            assertThat(db.sql("SELECT count(*) FROM observation WHERE id=:id AND NOT sample").param("id",id).query(Integer.class).single()).isEqualTo(1);
            var read=client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/events")).build(),HttpResponse.BodyHandlers.ofString());
            assertThat(read.statusCode()).isEqualTo(200);
            assertThat(read.body()).contains(id.toString());
        } finally {db.sql("DELETE FROM observation WHERE id=:id").param("id",id).update();}
    }
    @Test void rejectsInvalidCoordinatesAndMissingValues() throws Exception {
        for(String latitude:new String[]{"91","-91","null"}) assertThat(post(body("10000000-0000-0000-0000-000000000001",latitude)).statusCode()).isEqualTo(400);
        assertThat(post("{}").statusCode()).isEqualTo(400);
    }
    @Test void rejectsUnknownAndAreaLayers() throws Exception {
        assertThat(post(body("00000000-0000-0000-0000-000000000000","59.43")).statusCode()).isEqualTo(400);
        assertThat(post(body("10000000-0000-0000-0000-000000000003","59.43")).statusCode()).isEqualTo(400);
    }
    @Test void servesAreaGeometryAsJson() throws Exception {
        var response=client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/layers")).build(),HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).contains("\"type\":\"Polygon\"");
    }
}
