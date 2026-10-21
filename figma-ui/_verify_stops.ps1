# Post-deploy check for the STOPS fix (server commit ffd832f).
# Creates a fresh rider (probe accounts are timestamped), then runs _stops.mjs with it.
#
# BEFORE the fix every probe line printed `waypoints=null`.
# AFTER the fix expect:
#   waypoints: [obj]        -> waypoints=[{...},{...}]   (the current app's key)
#   stops: [obj]            -> waypoints=[{...},{...}]   (legacy key, now an alias)
#   waypoints: JSON string  -> waypoints=null            (a string is not an array)
#   route_data / route / baseline -> waypoints=null      (still not stored)
#   POST /api/rides/schedule + GET /api/rides/:id -> waypoints = [{...},{...}]
#
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File .\_verify_stops.ps1

$ErrorActionPreference = 'Continue'
# Suppress Node's TLS warning banner so the probe output stays readable.
$env:NODE_NO_WARNINGS = '1'
Set-Location $PSScriptRoot

Write-Host '=== 1/2 creating a fresh rider ==='
$mk = (node .\_mkrider.mjs 2>&1 | Out-String)
Write-Host $mk.Trim()

$email = ''
foreach ($line in ($mk -split "`n")) {
  if ($line -like '*created rider:*') { $email = (($line -split 'created rider:')[1]).Trim() }
}
if (-not $email) { Write-Host 'FAILED: could not create a rider (see output above)'; exit 1 }

Write-Host "=== 2/2 probing stops as $email ==="
$out = (node .\_stops.mjs $email 'FlowTest123!' 2>&1 | Out-String)
Write-Host $out

$log = 'C:\Users\mbofh\_stops_after_deploy.txt'
$out | Out-File $log -Encoding utf8

# The socket probes print `waypoints=${JSON.stringify(...)}`; the REST check prints
# `waypoints = ...`. JSON.stringify(null)/undefined never yields `[{`, so a non-empty
# array of stop objects on either path proves the fix is live.
$ok = $out.Contains('waypoints=[{"') -or $out.Contains('waypoints = [{"')
if ($ok) {
  Write-Host '=== RESULT: PASS - stops persist and come back on the ride ==='
} else {
  Write-Host '=== RESULT: still null - the new build is NOT serving yet (check eb deploy) ==='
}
Write-Host "full log: $log"
