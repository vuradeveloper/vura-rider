# Vura self-hosted OSRM + Nominatim (Phase 3 – scale/robustness)
#
# Why:
#   - Production currently uses the free public OSRM (router.project-osrm.org)
#     and Nominatim (nominatim.openstreetmap.org) servers.
#   - Those public servers explicitly ban HEAVY production use. Once your rider
#     base grows, they will throttle or block you.
#   - Self-hosting on the SAME AWS account costs $0 extra in software; you just
#     need one small instance (t3.small) + a free SA extract.
#
# ── 1) Provision one EC2 instance ──
#   • Name: vura-maps
#   • Ubuntu 22.04, t3.small (or "t3a.small"), 20GB gp3
#   • Security group: allow 8080 (OSRM) + 8081 (Nominatim) only from your EB env SG
#   • Attach an IAM role that can read S3 (not required for OSRM, only if you
#     want to pull extracts from an S3 bucket)
#
# ── 2) Install OSRM (the routing engine — powers /api/route) ──
#   ssh ubuntu@<vura-maps-ip>
#
#   sudo apt-get update && sudo apt-get install -y osmium-tool libboost-all-dev cmake build-essential git wget
#   git clone https://github.com/Project-OSRM/osrm-backend.git && cd osrm-backend
#   mkdir build && cd build && cmake .. -DCMAKE_BUILD_TYPE=Release && cmake --build . -j4
#   sudo make install
#
#   # Download the South Africa extract (daily, ~400MB) and build the routing graph
#   cd ~
#   wget https://download.geofabrik.de/africa/south-africa-latest.osm.pbf
#   osrm-extract -p /usr/local/share/osrm/car.lua south-africa-latest.osm.pbf
#   osrm-partition south-africa-latest.osrm
#   osrm-customize south-africa-latest.osrm
#
#   # Run the server on :8080
#   osrm-routed --algorithm mld --port 8080 south-africa-latest.osrm
#
# ── 3) Install Nominatim (geocoding/search — powers /api/search/geocode) ──
#   sudo apt-get install -y postgresql postgresql-contrib postgis osm2pgsql
#   # Follow the official Nominatim install for Ubuntu 22.04 (v4.x), then:
#   service postgresql start
#   nominatim import --project-dir /srv/nominatim --osm-file ~/south-africa-latest.osm.pbf
#   # Run the server on :8081
#   cd /srv/nominatim && sudo -u nominatim nominatim serve --port 8081
#
# ── 4) Point your EB server at them ──
#   In Elastic Beanstalk → your env → Configuration → Environment properties:
#     ROUTE_PROVIDER_URL=http://<vura-maps-ip>:8080
#     NOMINATIM_URL=http://<vura-maps-ip>:8081
#     SEARCH_PROVIDER=nominatim   (the server reads these env vars; defaults stay
#                                  the public free servers if unset)
#   Then redeploy (git pull && eb deploy) — no code change needed.
#
# ── 5) Keep it alive ──
#   # systemd units ensure osrm-routed + nominatim restart on reboot
#   sudo apt-get install -y supervisor
#   sudo tee /etc/supervisor/conf.d/vura-maps.conf >/dev/null <<'EOF'
#   [program:osrm]
#   command=/usr/local/bin/osrm-routed --algorithm mld --port 8080 /home/ubuntu/south-africa-latest.osrm
#   autostart=true
#   autorestart=true
#   user=ubuntu
#
#   [program:nominatim]
#   command=/srv/nominatim/nominatim serve --port 8081
#   autostart=true
#   autorestart=true
#   user=nominatim
#   EOF
#   sudo supervisorctl reread && sudo supervisorctl update
#
# That's it — after this, routing + search never rely on the public free servers
# again, giving you unlimited scale for $0 software cost.