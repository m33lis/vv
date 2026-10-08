package ee.vv;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;

@RestController
@RequestMapping("/api/addresses")
public class AddressSearchController {
    public record Address(String id, String label, double longitude, double latitude) {}
    private record Cached(List<Address> results, long expires) {}
    private final ObjectMapper json;
    private final URI endpoint;
    private final HttpClient client;
    private final Map<String,Cached> cache = new LinkedHashMap<>(256,0.75f,true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String,Cached> entry) {return size()>256;}
    };
    private double tokens=5;
    private long lastRefill=System.nanoTime();
    @Autowired
    public AddressSearchController(ObjectMapper json) {
        this(json,URI.create("https://aks.geoportaal.ee/inaks/inaadress/gazetteer"));
    }
    AddressSearchController(ObjectMapper json, URI endpoint) {
        this.json=json; this.endpoint=endpoint;
        this.client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }
    @GetMapping
    public List<Address> search(@RequestParam(defaultValue="") String q) {
        String query=q.strip().replaceAll("\\s+"," ");
        if(query.length()>160) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Use at most 160 characters");
        if(query.length()<3) return List.of();
        String key=query.toLowerCase(Locale.ROOT);
        synchronized(cache) {
            Cached existing=cache.get(key);
            if(existing!=null && existing.expires()>System.currentTimeMillis()) return existing.results();
        }
        permitRequest();
        URI uri=URI.create(endpoint+"?address="+URLEncoder.encode(query,StandardCharsets.UTF_8)
            +"&results=8&ihist=0&appartment=0&iTappAsendus=1");
        try {
            var response=client.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(8))
                .header("Accept","application/json").header("User-Agent","VV/0.2 address-search").GET().build(),HttpResponse.BodyHandlers.ofByteArray());
            if(response.statusCode()==429) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"Address service is busy. Wait a moment and try again.");
            if(response.statusCode()!=200 || response.body().length>2_000_000) throw new IOException("Unexpected address response");
            List<Address> results=parse(json.readTree(response.body()));
            synchronized(cache) {cache.put(key,new Cached(results,System.currentTimeMillis()+Duration.ofMinutes(10).toMillis()));}
            return results;
        } catch(InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Address search interrupted. Try again.");
        } catch(IOException | tools.jackson.core.JacksonException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"Address search is temporarily unavailable. You can still choose a location on the map.");
        }
    }
    private synchronized void permitRequest() {
        long now=System.nanoTime();
        tokens=Math.min(5,tokens+(now-lastRefill)/1_000_000_000.0*3);
        lastRefill=now;
        if(tokens<1) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"Please wait a moment before searching again.");
        tokens--;
    }
    private List<Address> parse(JsonNode root) throws IOException {
        if(root.has("error")) {
            String code=root.path("error").asText("");
            if(code.startsWith("LYHITXT") || code.equals("LIIGAYLDINE"))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Please add a street, house number or town to narrow the search.");
            throw new IOException("Provider error");
        }
        JsonNode addresses=root.path("addresses");
        // The live API omits addresses entirely when there are no matches.
        if(!root.has("addresses") && root.path("host").isTextual()) return List.of();
        if(!addresses.isArray()) throw new IOException("Missing address results");
        Map<String,Address> results=new LinkedHashMap<>();
        for(JsonNode entry:addresses) {
            String label=entry.path("ipikkaadress").asText("");
            if(label.isBlank()) label=entry.path("taisaadress").asText("");
            try {
                double lon=Double.parseDouble(entry.path("viitepunkt_l").asText(""));
                double lat=Double.parseDouble(entry.path("viitepunkt_b").asText(""));
                if(label.isBlank() || !Double.isFinite(lon) || !Double.isFinite(lat) || Math.abs(lon)>180 || Math.abs(lat)>90) continue;
                String id=entry.path("adr_id").asText("");
                if(id.isBlank()) id=label+":"+lon+":"+lat;
                results.putIfAbsent(id,new Address(id,label,lon,lat));
                if(results.size()==8) break;
            } catch(NumberFormatException ignored) { /* Unlocated matches cannot be placed on the map. */ }
        }
        return List.copyOf(results.values());
    }
}

