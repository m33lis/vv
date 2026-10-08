package ee.vv;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.*;

class AddressSearchTest {
    HttpServer server;
    AddressSearchController search;
    AtomicInteger requests=new AtomicInteger();
    volatile String query;
    volatile int status=200;
    volatile String body="""
        {"addresses":[{"adr_id":"1","ipikkaadress":"Õnne 1, Tartu","viitepunkt_l":"26.72","viitepunkt_b":"58.37"}]}
        """;
    @BeforeEach void start() throws Exception {
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/search",exchange->{
            requests.incrementAndGet();query=exchange.getRequestURI().getRawQuery();
            byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type","application/json");
            exchange.sendResponseHeaders(status,bytes.length);
            try(var out=exchange.getResponseBody()){out.write(bytes);}
        });
        server.start();
        search=new AddressSearchController(new ObjectMapper(),URI.create("http://127.0.0.1:"+server.getAddress().getPort()+"/search"));
    }
    @AfterEach void stop(){server.stop(0);}
    @Test void encodesEstonianQueryAndCachesNormalizedMatches(){
        var result=search.search("  Õnne   1 Tartu  ");
        assertThat(result).hasSize(1);
        assertThat(result.getFirst().longitude()).isEqualTo(26.72);
        assertThat(result.getFirst().latitude()).isEqualTo(58.37);
        assertThat(query).contains("address=%C3%95nne+1+Tartu","results=8","ihist=0");
        assertThat(search.search("õnne 1 tartu")).isEqualTo(result);
        assertThat(requests.get()).isEqualTo(1);
    }
    @Test void skipsUnlocatedInvalidAndDuplicateResults(){
        body="""
            {"addresses":[
              {"adr_id":"1","taisaadress":"Valid fallback","viitepunkt_l":24,"viitepunkt_b":59},
              {"adr_id":"1","taisaadress":"Duplicate","viitepunkt_l":24,"viitepunkt_b":59},
              {"adr_id":"2","taisaadress":"Unlocated"},
              {"adr_id":"3","taisaadress":"Invalid","viitepunkt_l":"NaN","viitepunkt_b":"91"}]}
            """;
        assertThat(search.search("test")).containsExactly(new AddressSearchController.Address("1","Valid fallback",24,59));
    }
    @Test void emptyResultsAreDifferentFromServiceFailures(){
        body="{\"host\":\"inaks-api\"}";
        assertThat(search.search("unknown")).isEmpty();
        body="<html>unavailable</html>";
        assertThatThrownBy(()->search.search("malformed")).isInstanceOfSatisfying(ResponseStatusException.class,e->assertThat(e.getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY));
        body="{}";
        assertThatThrownBy(()->search.search("missing fields")).isInstanceOf(ResponseStatusException.class);
        status=429;
        assertThatThrownBy(()->search.search("rate limited")).isInstanceOfSatisfying(ResponseStatusException.class,e->assertThat(e.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS));
    }
    @Test void validatesInputWithoutContactingProvider(){
        assertThat(search.search("ab")).isEmpty();
        assertThatThrownBy(()->search.search("x".repeat(161))).isInstanceOfSatisfying(ResponseStatusException.class,e->assertThat(e.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
        assertThat(requests.get()).isZero();
    }
}

