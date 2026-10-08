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
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "spring.flyway.schemas=vv_test","spring.flyway.default-schema=vv_test","spring.datasource.hikari.schema=vv_test"
})
@ActiveProfiles("demo")
class MapObjectIntegrationTest {
    @Value("${local.server.port}") int port;
    @Autowired JdbcClient db;
    @Autowired ObjectMapper json;
    final HttpClient client=HttpClient.newHttpClient();
    HttpResponse<String> request(String method,String path,String body) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api"+path))
            .header("Content-Type","application/json").method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    UUID layer(String source) throws Exception {
        var result=request("POST","/layers","{\"name\":\"Test grocery stores\",\"color\":\"#123456\",\"sourceKey\":"+source+"}");
        assertThat(result.statusCode()).isEqualTo(201);
        return UUID.fromString(json.readTree(result.body()).get("id").asText());
    }
    String object(UUID layer,String geometry) {
        return "{\"layerId\":\""+layer+"\",\"name\":\"Test object\",\"description\":\"Test description\",\"geometry\":"+geometry+"}";
    }
    void clean(UUID id) {
        db.sql("DELETE FROM map_object WHERE layer_id=:id").param("id",id).update();
        db.sql("DELETE FROM map_layer WHERE id=:id").param("id",id).update();
    }
    @Test void roundTripsMixedGeometryAndLayerSettings() throws Exception {
        UUID layer=layer("null");
        try {
            for(String geometry:new String[]{
                "{\"type\":\"Point\",\"coordinates\":[24.75,59.43]}",
                "{\"type\":\"LineString\",\"coordinates\":[[24.75,59.43],[24.76,59.44]]}",
                "{\"type\":\"Polygon\",\"coordinates\":[[[24.75,59.43],[24.76,59.43],[24.76,59.44],[24.75,59.43]]]}"}) {
                var created=request("POST","/objects",object(layer,geometry));
                assertThat(created.statusCode()).as(created.body()).isEqualTo(201);
                var id=json.readTree(created.body()).get("id").asText();
                var found=json.readTree(request("GET","/objects",null).body()).valueStream().filter(n->n.get("id").asText().equals(id)).findFirst().orElseThrow();
                assertThat(found.get("geometry")).isEqualTo(json.readTree(geometry));
                assertThat(found.get("layerId").asText()).isEqualTo(layer.toString());
            }
            assertThat(db.sql("SELECT count(*) FROM map_object WHERE layer_id=:id").param("id",layer).query(Integer.class).single()).isEqualTo(3);
            assertThat(request("PATCH","/layers/"+layer,"{\"visible\":false,\"opacity\":0.35}").statusCode()).isEqualTo(200);
            var saved=json.readTree(request("GET","/layers",null).body()).valueStream().filter(n->n.get("id").asText().equals(layer.toString())).findFirst().orElseThrow();
            assertThat(saved.get("visible").asBoolean()).isFalse();
            assertThat(saved.get("opacity").asDouble()).isEqualTo(0.35);
        } finally {clean(layer);}
    }
    @Test void rejectsInvalidAndSelfIntersectingGeometryWithoutSaving() throws Exception {
        UUID layer=layer("null");
        try {
            for(String geometry:new String[]{
                "{\"type\":\"Point\",\"coordinates\":[181,59]}",
                "{\"type\":\"Point\",\"coordinates\":[24,91]}",
                "{\"type\":\"LineString\",\"coordinates\":[[24,59],[24,59]]}",
                "{\"type\":\"Polygon\",\"coordinates\":[[[24,59],[25,60],[24,60],[25,59],[24,59]]]}",
                "{\"type\":\"Polygon\",\"coordinates\":[[[24,59],[25,59],[25,60]]]}",
                "{\"type\":\"MultiPoint\",\"coordinates\":[[24,59]]}"}) {
                var result=request("POST","/objects",object(layer,geometry));
                assertThat(result.statusCode()).as(result.body()).isEqualTo(400);
                assertThat(json.readTree(result.body()).has("detail")).isTrue();
            }
            assertThat(db.sql("SELECT count(*) FROM map_object WHERE layer_id=:id").param("id",layer).query(Integer.class).single()).isZero();
        } finally {clean(layer);}
    }
    @Test void protectsSourceCatalogAndValidatesLayerSettings() throws Exception {
        assertThat(request("POST","/layers","{\"name\":\"bad\",\"color\":\"#123456\",\"sourceKey\":\"https://example.com\"}").statusCode()).isEqualTo(400);
        assertThat(request("POST","/layers","{\"name\":\" \",\"color\":\"bad\"}").statusCode()).isEqualTo(400);
        UUID layer=layer("\"estonia-relief\"");
        try {
            assertThat(request("POST","/objects",object(layer,"{\"type\":\"Point\",\"coordinates\":[24,59]}")).statusCode()).isEqualTo(400);
            assertThat(request("PATCH","/layers/"+layer,"{\"visible\":true,\"opacity\":1.1}").statusCode()).isEqualTo(400);
            assertThat(request("PATCH","/layers/"+layer,"{\"visible\":null,\"opacity\":0.5}").statusCode()).isEqualTo(400);
        } finally {clean(layer);}
        assertThat(request("GET","/tiles/estonia-relief/18/0/0.png",null).statusCode()).isEqualTo(400);
        assertThat(request("GET","/tiles/unknown/10/0/0.png",null).statusCode()).isEqualTo(400);
    }
    @Test void deletesOnlySelectedLayerAndItsContents() throws Exception {
        UUID target=layer("null"), other=layer("null");
        try {
            String point="{\"type\":\"Point\",\"coordinates\":[24,59]}";
            assertThat(request("POST","/objects",object(target,point)).statusCode()).isEqualTo(201);
            assertThat(request("POST","/objects",object(other,point)).statusCode()).isEqualTo(201);
            String event="{\"layerId\":\"%s\",\"title\":\"Delete test\",\"description\":\"Temporary\",\"latitude\":59,\"longitude\":24,\"occurredAt\":\"2026-10-08T10:00:00Z\"}";
            assertThat(request("POST","/events",event.formatted(target)).statusCode()).isEqualTo(201);
            assertThat(request("POST","/events",event.formatted(other)).statusCode()).isEqualTo(201);
            assertThat(request("DELETE","/layers/"+target,null).statusCode()).isEqualTo(204);
            for(String table:new String[]{"map_object","observation"}) {
                assertThat(db.sql("SELECT count(*) FROM "+table+" WHERE layer_id=:id").param("id",target).query(Integer.class).single()).isZero();
                assertThat(db.sql("SELECT count(*) FROM "+table+" WHERE layer_id=:id").param("id",other).query(Integer.class).single()).isEqualTo(1);
            }
            assertThat(request("GET","/layers",null).body()).doesNotContain(target.toString()).contains(other.toString());
            assertThat(request("DELETE","/layers/"+target,null).statusCode()).isEqualTo(404);
        } finally {
            db.sql("DELETE FROM observation WHERE layer_id IN (:a,:b)").param("a",target).param("b",other).update();
            clean(target); clean(other);
        }
    }
    @Test void deletesExternalLayer() throws Exception {
        UUID id=layer("\"estonia-relief\"");
        try {
            assertThat(request("DELETE","/layers/"+id,null).statusCode()).isEqualTo(204);
            assertThat(request("GET","/layers",null).body()).doesNotContain(id.toString());
        } finally {clean(id);}
    }
    @Test void projectionUsesEstonianFalseOriginAndTilesOutsideCoverageAreTransparent() throws Exception {
        var p=ExternalMapController.projection().transform(new org.locationtech.proj4j.ProjCoordinate(24,57.5175539305556),new org.locationtech.proj4j.ProjCoordinate());
        assertThat(p.x).isCloseTo(500000,within(0.01));
        assertThat(p.y).isCloseTo(6375000,within(0.01));
        var response=new ExternalMapController().tile("estonia-relief",6,0,0);
        var image=javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(response.getBody()));
        assertThat(image.getWidth()).isEqualTo(256);
        assertThat(image.getRGB(128,128)>>>24).isZero();
    }
    @Test void updatesEventInPlaceAndPreservesProvenance() throws Exception {
        UUID first=layer("null"), second=layer("null");
        try {
            String body="{\"layerId\":\"%s\",\"title\":\"%s\",\"description\":\"Description\",\"latitude\":%s,\"longitude\":24,\"occurredAt\":\"2026-10-08T10:12:13.456Z\"}";
            var created=json.readTree(request("POST","/events",body.formatted(first,"Original","59")).body());
            UUID id=UUID.fromString(created.get("id").asText());
            db.sql("UPDATE observation SET sample=true,approximate=true,source_url='https://example.com/report' WHERE id=:id").param("id",id).update();
            var result=request("PUT","/events/"+id,body.formatted(second,"Updated","58"));
            assertThat(result.statusCode()).isEqualTo(200);
            var saved=json.readTree(result.body());
            assertThat(saved.get("id")).isEqualTo(created.get("id"));
            assertThat(saved.get("title").asText()).isEqualTo("Updated");
            assertThat(saved.get("layerId").asText()).isEqualTo(second.toString());
            assertThat(saved.get("latitude").asDouble()).isEqualTo(58);
            assertThat(saved.get("occurredAt")).isEqualTo(created.get("occurredAt"));
            assertThat(saved.get("sample").asBoolean()).isTrue();
            assertThat(saved.get("approximate").asBoolean()).isTrue();
            assertThat(saved.get("sourceUrl").asText()).isEqualTo("https://example.com/report");
            assertThat(request("PUT","/events/"+id,body.formatted(first,"Invalid","91")).statusCode()).isEqualTo(400);
            assertThat(db.sql("SELECT title FROM observation WHERE id=:id").param("id",id).query(String.class).single()).isEqualTo("Updated");
        } finally { clean(first); clean(second); }
    }
    @Test void editsObjectGeometryAndLayerWithoutCreatingDuplicates() throws Exception {
        UUID first=layer("null"), second=layer("null");
        try {
            var created=json.readTree(request("POST","/objects",object(first,"{\"type\":\"Point\",\"coordinates\":[24,59]}")).body());
            String id=created.get("id").asText();
            var originalCreatedAt=json.readTree(request("GET","/objects",null).body()).valueStream().filter(o->o.get("id").asText().equals(id)).findFirst().orElseThrow().get("createdAt");
            for(String geometry:new String[]{
                "{\"type\":\"LineString\",\"coordinates\":[[24,59],[25,59]]}",
                "{\"type\":\"Polygon\",\"coordinates\":[[[24,59],[25,59],[25,60],[24,59]]]}"}) {
                var result=request("PUT","/objects/"+id,object(second,geometry).replace("Test object","Edited object"));
                assertThat(result.statusCode()).isEqualTo(200);
                var saved=json.readTree(result.body());
                assertThat(saved.get("id")).isEqualTo(created.get("id"));
                assertThat(saved.get("createdAt")).isEqualTo(originalCreatedAt);
                assertThat(saved.get("geometry")).isEqualTo(json.readTree(geometry));
                assertThat(saved.get("name").asText()).isEqualTo("Edited object");
            }
            assertThat(request("PUT","/objects/"+id,object(first,"{\"type\":\"Polygon\",\"coordinates\":[[[24,59],[25,60],[24,60],[25,59],[24,59]]]}")).statusCode()).isEqualTo(400);
            assertThat(db.sql("SELECT count(*) FROM map_object WHERE layer_id=:id").param("id",second).query(Integer.class).single()).isEqualTo(1);
            assertThat(db.sql("SELECT count(*) FROM map_object WHERE layer_id=:id").param("id",first).query(Integer.class).single()).isZero();
        } finally {clean(first);clean(second);}
    }
    @Test void editingMissingItemsReturnsNotFound() throws Exception {
        UUID layer=layer("null"), missing=UUID.randomUUID();
        try {
            assertThat(request("PUT","/objects/"+missing,object(layer,"{\"type\":\"Point\",\"coordinates\":[24,59]}")).statusCode()).isEqualTo(404);
            String event="{\"layerId\":\"%s\",\"title\":\"Missing\",\"description\":\"Missing\",\"latitude\":59,\"longitude\":24,\"occurredAt\":\"2026-10-08T10:00:00Z\"}";
            assertThat(request("PUT","/events/"+missing,event.formatted(layer)).statusCode()).isEqualTo(404);
        } finally {clean(layer);}
    }}


