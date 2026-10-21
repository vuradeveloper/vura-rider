# ─────────────────────────────────────────────────────────────────────────────
# Ships the "stops survive booking" fix to the live API and restarts it.
#
#   .\_deploy_wp.ps1 -VmHost ubuntu@130.61.12.34 -KeyPath C:\Users\mbofh\Downloads\ssh-key.key
#
# Only two compiled files change (dist/routes/rides.js, dist/socket/handlers.js),
# so this is a 2-file copy + systemd restart — no npm install, no DB migration to
# run by hand (the server adds rides.waypoints itself on boot) and no downtime
# beyond the restart.
#
# Verified safe: the waypoints column is additive (JSONB, nullable) and every
# new query falls back to the old SQL if the column cannot be created.
# ─────────────────────────────────────────────────────────────────────────────
param(
  [Parameter(Mandatory = $true)][string]$VmHost,   # ubuntu@<vm-ip>
  [Parameter(Mandatory = $true)][string]$KeyPath   # path to the .pem/ssh key
)

$ErrorActionPreference = 'Stop'
$root  = Split-Path -Parent $MyInvocation.MyCommand.Path
$srv   = Join-Path $root 'server'
$probe = Join-Path $root 'figma-ui'

Write-Host "== 1/4  typecheck + build" -ForegroundColor Cyan
Push-Location $srv
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Typecheck failed - not deploying." }
npx tsc
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Build failed - not deploying." }
Pop-Location

Write-Host "== 2/4  upload the two changed files" -ForegroundColor Cyan
scp -i $KeyPath (Join-Path $srv 'dist\routes\rides.js')      "${VmHost}:~/vura-rides.js"
scp -i $KeyPath (Join-Path $srv 'dist\socket\handlers.js')   "${VmHost}:~/vura-handlers.js"

Write-Host "== 3/4  install + restart the service" -ForegroundColor Cyan
ssh -i $KeyPath $VmHost "sudo cp ~/vura-rides.js /opt/vura-rider/server/dist/routes/rides.js && sudo cp ~/vura-handlers.js /opt/vura-rider/server/dist/socket/handlers.js && rm ~/vura-rides.js ~/vura-handlers.js && sudo systemctl restart vura-rider && sleep 2 && curl -s http://localhost/health"

Write-Host "== 4/4  prove stops persist against the live API" -ForegroundColor Cyan
Push-Location $probe
node _stops.mjs
Pop-Location

Write-Host "Done. Expect the probe to report a non-null waypoints array." -ForegroundColor Green
