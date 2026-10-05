# VV · vaatlusvõrgustik

A first working slice of a map-based observation network: combine map layers, locate events, and add observations with a short description, WGS84 coordinates, and a timestamp.

## Included

- Java 25 / Spring Boot 4.1.1 REST API, Maven build.
- Angular 21 frontend with MapLibre GL JS, OpenFreeMap basemap, and milsymbol pins.
- PostgreSQL 17 persistence; Flyway schema migrations; GeoJSON polygons in JSONB.
- Toggleable pin and area layers; search; click an event or pin to inspect it.
- New observations saved to PostgreSQL. Click the map to choose a location or type latitude/longitude.
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

## API and data

| Endpoint | Purpose |
| --- | --- |
| `GET /api/events` | All observations, newest first |
| `POST /api/events` | Create an observation on an existing pin layer |
| `GET /api/layers` | Pin-layer metadata and area GeoJSON |

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

The `demo` profile adds historical samples. To start without samples, use a **fresh database** and omit that profile. Do not switch off the demo profile against a database already migrated with it: Flyway expects applied migrations to remain available. Future schema migrations must use versions greater than V2.

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

Four backend integration tests use the isolated `vv_test` schema in PostgreSQL, exercising create/read persistence, invalid coordinates and missing fields, rejection of unknown/area layers, and JSONB polygon serialization. Test-created observations are removed; development observations are untouched.

Browser checks cover basemap and pins, layer toggles, search, pin selection, source links, and saving a new observation. The basemap requires internet access. The build currently includes the MapLibre and milsymbol libraries; its compressed initial transfer is approximately 450 kB.

## Next increments

Timeline playback, expiry intervals, editing observations, drawing/importing areas, choosing symbols, live updates, and authentication remain future work. The initial UI uses DOM markers; for large datasets, move symbols into GPU-rendered MapLibre layers and add viewport/time queries and clustering. PostGIS can be added when spatial queries become necessary.
