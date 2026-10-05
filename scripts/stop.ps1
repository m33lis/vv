$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
if (Test-Path .local/processes.json) {
    $processes = Get-Content .local/processes.json | ConvertFrom-Json
    foreach ($processId in @($processes.backend,$processes.frontend)) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
        # Avoid terminating a reused PID belonging to a different program.
        if ($process -and ($process.CommandLine -match 'backend/target/vv-0\.1\.0-SNAPSHOT\.jar|scripts/preview\.mjs')) { Stop-Process -Id $processId }
    }
    Remove-Item -LiteralPath .local/processes.json
}
& .tools/postgres/bin/pg_ctl.exe -D .local/pgdata -m fast -w stop
Write-Host 'VV stopped. Database files are preserved.'
