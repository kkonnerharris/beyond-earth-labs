# Start, stop or check the three local services.
#   powershell -File scripts\services.ps1 start|stop|status
# Ports: mission 8300 (Go), science 8310 (Python), world 8320 (Python, the optional 3D rover world, started
# only if a surface-world folder is present; it is not part of this repository), web 4770 (Next.js).
param([Parameter(Position = 0)][ValidateSet("start", "stop", "status")][string]$Action = "status")

$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root "data\logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$ports = [ordered]@{ mission = 8300; science = 8310; world = 8320; web = 4770 }

function Get-Listener([int]$port) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Stop-Port([int]$port) {
    $c = Get-Listener $port
    if ($c) { Stop-Process -Id $c.OwningProcess -Force -Confirm:$false -ErrorAction SilentlyContinue }
}

if ($Action -eq "stop" -or $Action -eq "start") {
    foreach ($p in $ports.Values) { Stop-Port $p }
    Start-Sleep -Milliseconds 800
}

if ($Action -eq "start") {
    $go = Join-Path $root "mission\bin\missiond.exe"
    if (-not (Test-Path $go)) { Write-Error "mission\bin\missiond.exe is missing; build it with: go build -o bin\missiond.exe .\cmd\missiond"; exit 1 }
    Start-Process -FilePath $go -WorkingDirectory (Join-Path $root "mission") -WindowStyle Hidden `
        -ArgumentList "-terrain", "..\data\jezero", "-store", "..\data\missions", "-addr", "127.0.0.1:8300" `
        -RedirectStandardError (Join-Path $logs "missiond.log") -RedirectStandardOutput (Join-Path $logs "missiond.out.log")
    Start-Process -FilePath (Join-Path $root ".venv\Scripts\python.exe") -WorkingDirectory (Join-Path $root "science") -WindowStyle Hidden `
        -ArgumentList "-m", "uvicorn", "bel.api:app", "--host", "127.0.0.1", "--port", "8310" `
        -RedirectStandardError (Join-Path $logs "science_api.log") -RedirectStandardOutput (Join-Path $logs "science_api.out.log")
    if (Test-Path (Join-Path $root "surface-world\backend")) {
        Start-Process -FilePath (Join-Path $root ".venv\Scripts\python.exe") -WorkingDirectory (Join-Path $root "surface-world") -WindowStyle Hidden `
            -ArgumentList "-m", "uvicorn", "backend.api.main:app", "--host", "127.0.0.1", "--port", "8320" `
            -RedirectStandardError (Join-Path $logs "world.log") -RedirectStandardOutput (Join-Path $logs "world.out.log")
    }
    Start-Process -FilePath "node" -WorkingDirectory (Join-Path $root "web") -WindowStyle Hidden `
        -ArgumentList "node_modules\next\dist\bin\next", "start", "-p", "4770" `
        -RedirectStandardOutput (Join-Path $logs "web.log") -RedirectStandardError (Join-Path $logs "web.err.log")
    # The science service can take 15 seconds or more to import its libraries on a small machine.
    for ($i = 0; $i -lt 45; $i++) {
        $up = @($ports.Values | Where-Object { Get-Listener $_ }).Count
        if ($up -eq $ports.Count) { break }
        Start-Sleep -Seconds 1
    }
}

foreach ($name in $ports.Keys) {
    $c = Get-Listener $ports[$name]
    if ($c) { "{0,-8} listening on {1} (pid {2})" -f $name, $ports[$name], $c.OwningProcess }
    else { "{0,-8} not running on {1}" -f $name, $ports[$name] }
}
if ($Action -eq "start") { "Open http://localhost:4770" }
