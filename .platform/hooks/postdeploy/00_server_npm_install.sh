#!/bin/bash
# AL2023 Elastic Beanstalk postdeploy hook - guarantee the server can actually start.
# Runs AFTER the app is dragged out to /var/app/current and BEFORE the web service
# starts, so anything still missing here becomes a live 502.
#
# Two canaries, because they fail in completely different ways:
#   dotenv - the pure-JS canary. Missing means node_modules never arrived at all and
#            the process dies at once with MODULE_NOT_FOUND.
#   sharp  - the NATIVE canary. server/node_modules is built on the developer's own
#            machine and shipped inside the deploy zip (see .ebignore, which
#            re-includes it on purpose so a fresh instance boots without a 100MB
#            npm install). That shortcut is only safe for pure-JS packages. A Windows
#            checkout ships @img/sharp-win32-x64 to a Linux instance, and sharp then
#            throws "Could not load the sharp module using the linux-x64 runtime" the
#            moment the vehicle-image pipeline calls it. Nothing else complains: the
#            CarsXE search returns HTTP 200 with 9 images, every candidate fails, and
#            the car silently keeps the SVG icon.
set -e
exec > >(tee -a /var/log/vura_server_deps.log) 2>&1

if [ ! -d /var/app/current/server ]; then
  echo "VURA: [postdeploy] ERROR /var/app/current/server missing"
  exit 1
fi

cd /var/app/current/server

# True when deps are absent, or present but unusable on THIS platform.
deps_broken() {
  [ ! -e node_modules/dotenv ] && return 0
  [ ! -e node_modules/sharp ] && return 0
  node -e "require('sharp')" >/dev/null 2>&1 || return 0
  return 1
}

if deps_broken; then
  echo "VURA: [postdeploy] deps missing or sharp cannot load - installing for this platform"
  # Clear a foreign-platform sharp build first. While the shipped win32 copy is in
  # place npm can treat the optional @img/* dependency as already satisfied and never
  # fetch the linux-x64 binary this instance actually needs.
  rm -rf node_modules/@img node_modules/sharp
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
else
  echo "VURA: [postdeploy] deps present and sharp loads - skipping install"
fi

# Hard verify the pure-JS canary - else the app dies with MODULE_NOT_FOUND.
if [ ! -e node_modules/dotenv ]; then
  echo "VURA: [postdeploy] ERROR dotenv still missing after install"
  exit 1
fi

# sharp is deliberately NOT fatal. The API serves rides perfectly without it, so
# failing the deploy here would trade a missing photo for a dead backend. It must
# still be loud, because a broken sharp is otherwise invisible until a driver asks
# why his car is showing a grey icon, and the reason now lands in
# vehicle_images.last_error for the review page.
if node -e "require('sharp')" >/dev/null 2>&1; then
  echo "VURA: [postdeploy] verified dotenv + sharp OK"
else
  echo "VURA: [postdeploy] WARNING sharp cannot load on this platform - vehicle images will degrade and report a reason"
  node -e "require('sharp')" 2>&1 | head -n 6 || true
fi
