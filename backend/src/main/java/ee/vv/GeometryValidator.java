package ee.vv;

import org.locationtech.jts.geom.*;
import org.locationtech.jts.operation.valid.IsValidOp;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import java.util.HashSet;

final class GeometryValidator {
    private static final GeometryFactory FACTORY = new GeometryFactory();
    static void validate(JsonNode geometry) {
        if (geometry == null || !geometry.isObject()) fail("Geometry is required");
        JsonNode coordinates = geometry.get("coordinates");
        if (coordinates == null || !coordinates.isArray()) fail("Coordinates must be an array");
        switch (geometry.path("type").asText()) {
            case "Point" -> position(coordinates);
            case "LineString" -> {
                Coordinate[] line = positions(coordinates, 2);
                if (FACTORY.createLineString(line).getLength() == 0) fail("A line needs two different positions");
            }
            case "Polygon" -> {
                if (coordinates.size() != 1) fail("Draw one exterior boundary without holes");
                Coordinate[] ring = positions(coordinates.get(0), 4);
                if (!ring[0].equals2D(ring[ring.length-1])) fail("Area boundary must be closed");
                if (new HashSet<>(java.util.Arrays.asList(ring)).size() < 3) fail("An area needs three different corners");
                Polygon polygon = FACTORY.createPolygon(ring);
                var validation = new IsValidOp(polygon);
                if (!validation.isValid() || polygon.getArea() <= 1e-14) fail("Area boundary must enclose space without crossing itself");
            }
            default -> fail("Use a Point, LineString or Polygon geometry");
        }
    }
    private static Coordinate[] positions(JsonNode coordinates, int minimum) {
        if (!coordinates.isArray() || coordinates.size() < minimum || coordinates.size() > 1000)
            fail("Use between " + minimum + " and 1000 positions");
        Coordinate[] points = new Coordinate[coordinates.size()];
        for (int i=0;i<points.length;i++) points[i]=position(coordinates.get(i));
        return points;
    }
    private static Coordinate position(JsonNode value) {
        if (!value.isArray() || value.size()!=2 || !value.get(0).isNumber() || !value.get(1).isNumber())
            fail("Each position must contain longitude and latitude");
        double x=value.get(0).doubleValue(), y=value.get(1).doubleValue();
        if (!Double.isFinite(x) || !Double.isFinite(y) || x < -180 || x > 180 || y < -90 || y > 90)
            fail("Coordinates are outside WGS84 bounds");
        return new Coordinate(x,y);
    }
    private static void fail(String message) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST,message); }
}
