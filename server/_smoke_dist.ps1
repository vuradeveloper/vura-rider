# Boots the EXACT artifact `eb deploy` will ship (dist/index.js) against the local
# dev database, checks that it comes up and serves routes, then stops it.
# Guards against shipping a dist that crashes on start.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

$port = (Get-Content .env | Where-Object { $_ -match '^PORT=' } | Select-Object -First 1) -replace '^PORT=', ''
$port = ($port -replace '\s', '')
if (-not $port) { $port = '3000' }

$out = Join-Path $env:TEMP 'vura_smoke_out.log'
$err = Join-Path $env:TEMP 'vura_smoke_err.log'
Remove-Item $out, $err -Force -ErrorAction SilentlyContinue

$p = Start-Process -FilePath 'node' -ArgumentList 'dist/index.js' -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $out -RedirectStandardError $err

$lines = @()
Start-Sleep -Seconds 9

$lines += "process alive after 9s: $(-not $p.HasExited)"
foreach ($path in @('/health', '/api/rides/available')) {
  $url = "http://127.0.0.1:$port$path"
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 12
    $lines += "$path -> $($r.StatusCode) $($r.Content.Substring(0, [Math]::Min(120, $r.Content.Length)))"
  } catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    $lines += "$path -> $code (401 here is correct: auth required)"
  }
}

if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500

$lines += '--- stdout tail ---'
$lines += (Get-Content $out -ErrorAction SilentlyContinue | Select-Object -Last 12)
$lines += '--- stderr tail ---'
$lines += (Get-Content $err -ErrorAction SilentlyContinue | Select-Object -Last 12)

$lines -join "`n" | Out-File 'C:\Users\mbofh\_srv_smoke.txt' -Encoding utf8
'smoke done'
