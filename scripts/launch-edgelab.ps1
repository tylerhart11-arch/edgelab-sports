$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$port = if ($env:PORT) { $env:PORT } else { "4317" }
$url = "http://127.0.0.1:$port"

try {
  $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2
} catch {
  $health = $null
}

if (-not $health.ok) {
  Start-Process -FilePath "node" -ArgumentList "server/index.mjs" -WorkingDirectory $root -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 12; $attempt++) {
    Start-Sleep -Milliseconds 750
    try {
      $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2
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
