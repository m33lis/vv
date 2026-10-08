package ee.vv;

import org.locationtech.proj4j.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.net.http.HttpRequest;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

/** Fixed provider catalog and bounded tile proxy. No user-supplied remote URLs are fetched. */
@RestController
@RequestMapping("/api")
public class ExternalMapController {
    public record Source(String key, String name, String description, String wmsLayer, String attribution, String infoUrl) {}
    private static final String INFO="https://geoportaal.maaamet.ee/est/ruumiandmed/korgusandmed/korgusmudelid-p508.html";
    private static final List<Source> SOURCES=List.of(
        new Source("estonia-relief","Estonia · colour relief","Terrain elevation shown as coloured shaded relief. A visual overlay, not a numeric height readout.","vreljeef","Maa- ja Ruumiamet",INFO),
        new Source("estonia-hillshade","Estonia · hillshade","Grayscale shading shows changes in terrain. Use opacity to blend it with the basemap.","reljeef","Maa- ja Ruumiamet",INFO),
        new Source("estonia-surface","Estonia · surface heights","nDSM visualisation of buildings and vegetation above the ground. Zoom in to see local detail.","nDSM","Maa- ja Ruumiamet",INFO));
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
    private final Semaphore requests=new Semaphore(4);
    private record Cached(byte[] bytes, long expires) {}
    private final Map<String,Cached> cache=Collections.synchronizedMap(new LinkedHashMap<>(128,0.75f,true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String,Cached> entry) {return size()>128;}
    });
    @GetMapping("/sources") public List<Source> sources() {return SOURCES;}
    static Source source(String key) {return SOURCES.stream().filter(s->s.key().equals(key)).findFirst()
        .orElseThrow(()->new ResponseStatusException(HttpStatus.BAD_REQUEST,"Unknown external source"));}

    @GetMapping(value="/tiles/{key}/{z}/{x}/{y}.png",produces=MediaType.IMAGE_PNG_VALUE)
    public ResponseEntity<byte[]> tile(@PathVariable String key,@PathVariable int z,@PathVariable int x,@PathVariable int y) {
        Source source=source(key);
        if(z<6 || z>17 || x<0 || y<0 || x>=(1<<z) || y>=(1<<z))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Tile coordinates out of range");
        String cacheKey=key+"/"+z+"/"+x+"/"+y;
        Cached cached=cache.get(cacheKey);
        if(cached!=null && cached.expires()>System.currentTimeMillis()) return image(cached.bytes());
        boolean acquired=false;
        try {
            acquired=requests.tryAcquire(25,TimeUnit.SECONDS);
            if(!acquired) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Elevation service is busy; retry shortly");
            // Recheck after waiting, to avoid fetching a tile already completed by another request.
            cached=cache.get(cacheKey);
            if(cached!=null && cached.expires()>System.currentTimeMillis()) return image(cached.bytes());
            byte[] bytes=render(source,z,x,y);
            cache.put(cacheKey,new Cached(bytes,System.currentTimeMillis()+Duration.ofHours(1).toMillis()));
            return image(bytes);
        } catch(InterruptedException e) {
            Thread.currentThread().interrupt(); throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Tile request interrupted");
        } catch(IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,"Elevation provider is unavailable; your saved objects are unaffected");
        } finally {if(acquired)requests.release();}
    }
    private ResponseEntity<byte[]> image(byte[] bytes) {
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(Duration.ofHours(1))).contentType(MediaType.IMAGE_PNG).body(bytes);
    }
    static CoordinateTransform projection() {
        CRSFactory crs=new CRSFactory();
        return new CoordinateTransformFactory().createTransform(
            crs.createFromParameters("WGS84","+proj=longlat +datum=WGS84 +no_defs"),
            crs.createFromParameters("EPSG:3301","+proj=lcc +lat_1=59.3333333333333 +lat_2=58 +lat_0=57.5175539305556 +lon_0=24 +x_0=500000 +y_0=6375000 +ellps=GRS80 +units=m +no_defs"));
    }
    private static ProjCoordinate project(CoordinateTransform transform,double x,double y,int z) {
        double n=Math.scalb(1.0,z);
        double lon=x/n*360-180;
        double lat=Math.toDegrees(Math.atan(Math.sinh(Math.PI*(1-2*y/n))));
        return transform.transform(new ProjCoordinate(lon,lat),new ProjCoordinate());
    }
    private byte[] render(Source source,int z,int x,int y) throws IOException,InterruptedException {
        BufferedImage output=new BufferedImage(256,256,BufferedImage.TYPE_INT_ARGB);
        double n=1<<z,west=x/n*360-180,east=(x+1)/n*360-180;
        double north=Math.toDegrees(Math.atan(Math.sinh(Math.PI*(1-2*y/n))));
        double south=Math.toDegrees(Math.atan(Math.sinh(Math.PI*(1-2*(y+1)/n))));
        if(east<19.4||west>30.7||north<57.1||south>60.4) return png(output);
        CoordinateTransform transform=projection();
        double minX=Double.POSITIVE_INFINITY,minY=minX,maxX=Double.NEGATIVE_INFINITY,maxY=maxX;
        // Densify edges: a rectangular Mercator tile is curved in the provider's LCC projection.
        for(int i=0;i<=16;i++) for(int edge=0;edge<4;edge++) {
            double t=i/16.0;
            ProjCoordinate p=project(transform,x+(edge<2?t:edge-2),y+(edge<2?edge:t),z);
            minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);
        }
        double padX=(maxX-minX)/512,padY=(maxY-minY)/512;
        minX-=padX;maxX+=padX;minY-=padY;maxY+=padY;
        String url="https://kaart.maaamet.ee/wms/fotokaart?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS="+source.wmsLayer()
            +"&STYLES=&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3301&WIDTH=512&HEIGHT=512&BBOX="
            +minX+","+minY+","+maxX+","+maxY+"&ASUTUS=VV&KESKKOND=DEV&IS=VV";
        HttpRequest request=HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(15)).header("User-Agent","VV/0.2 elevation-viewer").GET().build();
        HttpResponse<byte[]> response=client.send(request,HttpResponse.BodyHandlers.ofByteArray());
        if(response.statusCode()!=200 || response.body().length>8_000_000 ||
            !response.headers().firstValue("content-type").orElse("").startsWith("image/")) throw new IOException("Provider returned no image");
        BufferedImage input=ImageIO.read(new ByteArrayInputStream(response.body()));
        if(input==null || input.getWidth()!=512 || input.getHeight()!=512) throw new IOException("Unexpected provider image");
        for(int row=0;row<256;row++) for(int col=0;col<256;col++) {
            ProjCoordinate p=project(transform,x+(col+0.5)/256,y+(row+0.5)/256,z);
            int sx=(int)Math.floor((p.x-minX)/(maxX-minX)*512);
            int sy=(int)Math.floor((maxY-p.y)/(maxY-minY)*512);
            if(sx>=0&&sx<512&&sy>=0&&sy<512) output.setRGB(col,row,input.getRGB(sx,sy));
        }
        return png(output);
    }
    private static byte[] png(BufferedImage image) throws IOException {
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();ImageIO.write(image,"png",bytes);return bytes.toByteArray();
    }
}

