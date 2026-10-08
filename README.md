# VV · vaatlusvõrgustik

A first working slice of a map-based observation network: combine map layers, locate events, and add observations with a short description, WGS84 coordinates, and a timestamp.

## Included

- Java 25 / Spring Boot 4.1.1 REST API, Maven build.
- Angular 21 frontend with MapLibre GL JS, OpenFreeMap basemap, and milsymbol pins.
- PostgreSQL 17 persistence; Flyway schema migrations; GeoJSON polygons in JSONB.
- Named object layers containing points, lines, and drawn areas, with persisted visibility and search.
- Right-click the map to create an event or map object at that location. Both are stored in PostgreSQL.
- Official Estonian colour relief, hillshade, and surface-height overlays with saved opacity controls.
- Three historical sample observations from two ERR reports, with source links and approximate locations.

## Run on this Windows machine

Open PowerShell in `C:\Users\Mel\IdeaProjects\vv`:

```powershell
./scripts/start.ps1 -SkipBuild
```

Open http://127.0.0.1:4200. Stop with `./scripts/stop.ps1`. If VV is already running, stop it before starting another instance. Run `./scripts/start.ps1` without `-SkipBuild` after editing code; it installs the locked frontend dependencies, runs backend integration tests, builds both applications, and starts them in the background.

Java 25 is installed privately in `.tools/java/jdk-25.0.4.1+1`. Java 24 on the system PATH is unchanged. The startup script selects the local Java 25 automatically. In IntelliJ, open this repository, import `backend/pom.xml`, and select that Java 25 directory as the project SDK and Maven runner JDK.

Local PostgreSQL listens on `127.0.0.1:54329`, database/user `vv`, development password `vv-local`. Database files live in `.local/pgdata`; logs and process IDs are in `.local`. Both directories are ignored by Git. Stopping VV preserves observations. This is a local prototype with no authentication.

For a fresh Windows x64 clone, first install Node 24 and Maven 3.9+, then run:

```powershell
node scripts/setup.mjs
./scripts/start.ps1
```

The setup script downloads a checksum-verified Temurin JDK 25, a portable PostgreSQL distribution from Maven Central, and a project-local npm. It does not change the machine's Java installation or register a Windows service.

## Development

Run PostgreSQL with the startup script, then stop only the two app processes if using separate development servers. With Java 25 selected:

```powershell
mvn -f backend/pom.xml spring-boot:run -Dspring-boot.run.profiles=demo
# In a second terminal:
cd frontend
npm ci
npm start
```

Angular proxies `/api` to `127.0.0.1:8080`. The local preview server (`node scripts/preview.mjs`) serves the production build and uses the same proxy. The preview server is a local development convenience.

Database overrides: `DB_URL`, `DB_USER`, `DB_PASSWORD`; backend overrides: `PORT`, `SERVER_ADDRESS`. By default the backend binds only to loopback.

## Docker alternative

With Docker installed, stop the local services first, then run:

```sh
docker compose up --build -d
```

Open http://127.0.0.1:4200. `docker compose down` preserves the named `vv-data` volume. The container setup uses its own database volume, separate from the Windows `.local/pgdata` instance. Docker was not available on the original machine, so this path has not been run there.

## Working with layers and objects

1. Use **Add layer → My objects** to create a layer such as Grocery stores.
2. Right-click a location and choose **Create object here**. Give it a name and choose its layer.
3. Keep **Point**, or change Shape to **Line** or **Area boundary**. The selected location becomes the first vertex. Click the map for more vertices, use **Undo point** if needed, then **Finish shape** and **Save object**. **Continue drawing** reopens an unfinished boundary; Escape cancels the draft.
4. Layer checkboxes show/hide their objects and events. The Objects tab lists visible objects; selecting one focuses its geometry. Search applies to both lists and the map.
5. Use **Delete** beside a layer and confirm **Delete permanently** to remove it and its objects/events. Cancel leaves everything intact. External layers remove only the saved overlay definition.
6. Choose **Create event here** for a dated observation rather than a persistent place or boundary.

Select an event or object on the map or in its list, then use **Edit event** or **Edit object**. The form is prefilled. Move points by clicking the map or entering coordinates. For areas/lines, select a boundary point to edit its coordinates, continue drawing, or redraw the shape. **Save changes** updates the existing item; closing the form or pressing Escape discards the draft. Changes are validated before saving. Object creation times and event source/sample metadata are preserved. Concurrent edits currently use last-save-wins behavior.

Geometry is stored as WGS84 GeoJSON in PostgreSQL JSONB. Areas have one exterior boundary, without holes, and must not cross themselves. Lines and areas accept up to 1,000 coordinates (including the closing coordinate). Layer visibility and opacity are shared workspace settings stored in the database, not per-browser preferences. Saving into a hidden layer makes that layer visible.

### External elevation

Use **Add layer → External elevation source**, choose a source, and create the layer. Toggle it like other layers and adjust its opacity:

- **Colour relief:** terrain elevation rendered as coloured shaded relief.
- **Hillshade:** grayscale terrain shading.
- **Surface heights:** nDSM imagery showing buildings and vegetation above ground.

Data attribution: **Maa- ja Ruumiamet**. [Height models](https://geoportaal.maaamet.ee/est/ruumiandmed/korgusandmed/korgusmudelid-p508.html) and [relief service documentation](https://geoportaal.maaamet.ee/est/Ruumiandmed/Topokaardid-ja-aluskaardid/Reljeef-ja-reljeefvarjutus-p207.html).

These are visual overlays, not numerical elevation queries or 3D terrain. The official relief layers currently expose EPSG:3301 through WMS, so the backend reprojects them into MapLibre's Mercator tiles. The adapter uses a fixed source catalog, four concurrent upstream requests, request timeouts, a 128-tile memory cache with a one-hour lifetime, and zoom levels 6–17. Layer definitions persist in PostgreSQL; imagery stays on the provider and is cached temporarily. Below zoom 6 the overlays are hidden; above zoom 17 MapLibre enlarges the last available tiles. The basemap and elevation overlays require internet access. A tile error can be retried or its layer hidden while continuing to work with saved objects. General WMS/WCS URL import and raw DEM downloads are not included yet.
## API and data

| Endpoint | Purpose |
| --- | --- |
| `GET /api/events` | All observations, newest first |
| `PUT /api/events/{id}` | Edit event details, time, location, and layer; retain source metadata |
| `POST /api/events` | Create an observation on a pin or object layer |
| `GET /api/layers` | Layer metadata, visibility, opacity, and legacy area GeoJSON |
| `DELETE /api/layers/{id}` | Permanently delete a layer and its objects/events atomically |
| `POST /api/layers` | Create an object layer or catalogued external overlay |
| `PATCH /api/layers/{id}` | Save `{ "visible": true, "opacity": 0.7 }` |
| `GET /api/objects` | Persistent map objects with GeoJSON geometry |
| `PUT /api/objects/{id}` | Edit object name, description, layer, and geometry in place |
| `POST /api/objects` | Create a named Point, LineString, or Polygon on an object layer |
| `GET /api/sources` | Available official elevation sources and descriptions |
| `GET /api/tiles/{sourceKey}/{z}/{x}/{y}.png` | Cached, reprojected elevation tiles |

Example request:

```json
{
  "layerId": "10000000-0000-0000-0000-000000000001",
  "title": "Road observation",
  "description": "Short field note.",
  "latitude": 59.437,
  "longitude": 24.7536,
  "occurredAt": "2026-10-04T10:00:00Z"
}
```

Timestamps are stored as `timestamptz` and exchanged as ISO 8601 instants. The UI uses the viewer's local timezone. Coordinates are decimal degrees, latitude then longitude in forms; GeoJSON uses longitude then latitude. Observations currently use a neutral generic ground symbol (`SNGP-----------`). SIDCs are stored per observation, ready for a symbol picker later. Pin symbols do not classify the underlying news as military activity.

The `demo` profile adds historical samples. To start without samples, use a **fresh database** and omit that profile. Do not switch off the demo profile against a database already migrated with it: Flyway expects applied migrations to remain available. Future schema migrations must use versions greater than V4.

Sources:

- [ERR: Tallinn roadwork overview, 19 August 2024](https://news.err.ee/1609428490/roadwork-overview-what-to-expect-in-tallinn-by-september-1): Harbor tramway and Tondi crossing examples.
- [ERR: Tram service and Vana-Kalamaja reopening, 24 August 2023](https://news.err.ee/1609074554/tallinn-trams-2-4-to-resume-vana-kalamaja-tanav-reopen-from-september): Vana-Kalamaja example.

Descriptions are short paraphrases. Coordinates are manually approximated. Sample timestamps use publication day at noon UTC, not exact incident times. The polygon is an invented study boundary. None of these samples represents a current alert.

## Verification

With local PostgreSQL running and Java 25 selected:

```powershell
mvn -f backend/pom.xml test
cd frontend
npm run build
```

Thirteen backend tests use the isolated `vv_test` schema in PostgreSQL. They cover event persistence, mixed point/line/polygon object round-trips, saved visibility and opacity, invalid coordinates, self-intersecting and unclosed polygons, forbidden layers and sources, the elevation projection origin, and layer deletion with cascading contents and isolation from other layers. Editing tests verify in-place updates, layer changes, geometry validation, missing IDs, and preservation of source metadata and creation timestamps. Test records are removed; development observations are untouched. Provider availability is checked separately rather than making the test suite depend on the internet.

Browser checks cover right-click coordinate selection, event and object saves, drawing areas and lines, undo, visibility after reload, and external overlay opacity after reload. The basemap requires internet access. The build currently includes the MapLibre and milsymbol libraries; its compressed initial transfer is approximately 450 kB.

## Next increments

Timeline playback, expiry intervals, importing GeoJSON, deleting individual objects and renaming layers, choosing symbols, live updates, and authentication remain future work. The initial UI uses DOM markers; for large datasets, move symbols into GPU-rendered MapLibre layers and add viewport/time queries and clustering. PostGIS can be added when spatial queries become necessary.
