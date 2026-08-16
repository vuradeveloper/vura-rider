#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Vura Rider backend — one-shot installer for Oracle Cloud Always Free Ubuntu VM
# Run as:  sudo bash install.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR=/opt/vura-rider
SRC_DIR="$APP_DIR/server"
SERVICE_FILE=/etc/systemd/system/vura-rider.service
NGINX_CONF=/etc/nginx/sites-available/vura-rider

echo "==> Updating system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -qq -y

echo "==> Installing Node.js 22 LTS"
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v && npm -v

echo "==> Installing nginx + certbot"
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Creating app directory"
mkdir -p "$APP_DIR"

# NOTE: copy the built server into /opt/vura-rider/server manually first, e.g.:
#   sudo rsync -av --exclude node_modules ./server "$APP_DIR/"   (then npm ci inside)

if [ -d "$SRC_DIR" ] && [ -f "$SRC_DIR/package.json" ]; then
  echo "==> Installing server dependencies"
  cd "$SRC_DIR"
  npm ci --omit=dev
fi

echo "==> Installing systemd service"
cp "$(dirname "$0")/vura-rider.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable vura-rider
systemctl start vura-rider
sleep 2
systemctl status vura-rider --no-pager || true

echo "==> Configuring nginx"
cp "$(dirname "$0")/nginx-vura.conf" "$NGINX_CONF"
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/vura-rider
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

echo ""
echo "✅ Backend installed."
echo "   App should respond on http://<SERVER_IP>/health"
echo ""
echo "Next: obtain an SSL cert once a domain points here:"
echo "   sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com"
echo ""
