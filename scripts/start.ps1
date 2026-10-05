param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
New-Item -ItemType Directory -Force -Path .local | Out-Null
$localJdk = Get-ChildItem -Directory .tools/java -ErrorAction SilentlyContinue | Select-Object -First 1
if ($localJdk) { $env:JAVA_HOME = $localJdk.FullName; $env:PATH = "$env:JAVA_HOME\bin;$env:PATH" }
$node = (Get-Command node).Source
if (!(Test-Path .tools/postgres/bin/postgres.exe)) { throw 'Run node scripts/setup.mjs first, or use Docker Compose.' }
if (!(Test-Path .local/pgdata/PG_VERSION)) {
    Set-Content .local/pg-password 'vv-local' -NoNewline
    & .tools/postgres/bin/initdb.exe -D .local/pgdata -U vv --pwfile=.local/pg-password --auth=scram-sha-256 --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL initialization failed.' }
    Add-Content .local/pgdata/postgresql.conf "`nlisten_addresses = '127.0.0.1'`nport = 54329`ntimezone = 'Europe/Tallinn'"
}
# Bind all three processes to loopback. Keep persistent data under .local/pgdata.
& .tools/postgres/bin/pg_ctl.exe -D .local/pgdata status *> $null
if ($LASTEXITCODE -ne 0) {
    $pgProcess = Start-Process .tools/postgres/bin/postgres.exe -ArgumentList '-D .local/pgdata' -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput "$repo/.local/postgres.log" -RedirectStandardError "$repo/.local/postgres-error.log" -PassThru
}
& $node scripts/database.mjs
if ($LASTEXITCODE -ne 0) { throw 'Database setup failed.' }
if (!$SkipBuild) {
    & mvn -B -f backend/pom.xml "-Dmaven.repo.local=$repo/.tools/m2" package
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
    Push-Location frontend
    try {
        & $node ../.tools/package/bin/npm-cli.js ci --cache ../.tools/npm-cache --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
        & $node ../.tools/package/bin/npm-cli.js run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    } finally { Pop-Location }
}
$java = (Get-Command java).Source
foreach ($port in @(8080,4200)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is already in use. Stop the existing VV process before starting again." }
}
$backend = Start-Process $java -ArgumentList '-jar backend/target/vv-0.1.0-SNAPSHOT.jar --spring.profiles.active=demo' -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput "$repo/.local/backend.log" -RedirectStandardError "$repo/.local/backend-error.log" -PassThru
$frontend = Start-Process $node -ArgumentList 'scripts/preview.mjs' -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput "$repo/.local/frontend.log" -RedirectStandardError "$repo/.local/frontend-error.log" -PassThru
@{ backend = $backend.Id; frontend = $frontend.Id } | ConvertTo-Json | Set-Content .local/processes.json
Write-Host 'VV: http://127.0.0.1:4200 (backend may take a few seconds to start).'
