$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$port = if ($env:PORT) { $env:PORT } else { "4317" }
$baseUrl = "http://127.0.0.1:$port"
$buildStamp = "20260614-live-slate"
$url = "$baseUrl/?view=worldcup&build=$buildStamp"

try {
  $health = Invoke-RestMethod "$baseUrl/api/health" -TimeoutSec 2
} catch {
  $health = $null
}

try {
  $worldCup = Invoke-RestMethod "$baseUrl/api/world-cup-2026" -TimeoutSec 4
} catch {
  $worldCup = $null
}

$hasCurrentApp = $health.ok -and $health.build -eq $buildStamp -and $worldCup.matches.Count -ge 100

if (-not $hasCurrentApp -and $health.ok) {
  $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq "node") {
      Stop-Process -Id $process.Id -Force
    }
  }
  Start-Sleep -Milliseconds 500
  $health = $null
}

if (-not $hasCurrentApp) {
  Start-Process -FilePath "node" -ArgumentList "server/index.mjs" -WorkingDirectory $root -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 12; $attempt++) {
    Start-Sleep -Milliseconds 750
    try {
      $health = Invoke-RestMethod "$baseUrl/api/health" -TimeoutSec 2
      if ($health.ok) { break }
    } catch {}
  }
}

$edgeCandidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
  "${env:LocalAppData}\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) }

if ($edgeCandidates.Count -gt 0) {
  Start-Process -FilePath $edgeCandidates[0] -ArgumentList "--app=$url"
} else {
  Start-Process $url
}
