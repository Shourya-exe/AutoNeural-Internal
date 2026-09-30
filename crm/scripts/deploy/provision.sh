#!/usr/bin/env bash
# One-time server setup for the AutoNeural / RapidX CRM on a fresh Ubuntu 22.04/24.04 VPS.
# Run as root (deploy.sh does this for you on the first deploy). Safe to re-run.
#
# Installs: Node.js 24, pm2, PostgreSQL, Redis, Python 3 (voice agent), Caddy (HTTPS),
# creates the `autoneural` app user + database, opens only SSH/80/443, adds 2 GB swap.
set -euo pipefail

DOMAIN="${DOMAIN:?set DOMAIN, e.g. demo.autoneural.in}"
SSH_PORT="${SSH_PORT:-22}"
APP_USER="autoneural"
APP_DIR="/var/www/autoneural-crm"
DB_NAME="autoneural_crm"
DB_PASS_FILE="/root/.autoneural-db-pass"

export DEBIAN_FRONTEND=noninteractive
log() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }

log "Base packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg ufw rsync git build-essential openssl \
  postgresql postgresql-contrib redis-server python3 python3-venv python3-pip \
  debian-keyring debian-archive-keyring apt-transport-https

log "Swap (2 GB) so the Next.js build can't run out of memory"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Node.js 24 + pm2"
if ! node -v 2>/dev/null | grep -qE '^v(2[4-9]|[3-9][0-9])\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2 >/dev/null

log "Caddy (automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
EOF
systemctl enable --now caddy
systemctl reload caddy

log "App user ${APP_USER} (same SSH keys as root, no password login)"
id -u "$APP_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$APP_USER"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/${APP_USER}/.ssh"
if [ -f /root/.ssh/authorized_keys ]; then
  install -m 600 -o "$APP_USER" -g "$APP_USER" /root/.ssh/authorized_keys "/home/${APP_USER}/.ssh/authorized_keys"
fi
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"

log "PostgreSQL + Redis (localhost only)"
systemctl enable --now postgresql redis-server
[ -f "$DB_PASS_FILE" ] || { openssl rand -hex 24 > "$DB_PASS_FILE"; chmod 600 "$DB_PASS_FILE"; }
DB_PASS="$(cat "$DB_PASS_FILE")"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${APP_USER}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE ${APP_USER} LOGIN PASSWORD '${DB_PASS}'"
sudo -u postgres psql -c "ALTER ROLE ${APP_USER} PASSWORD '${DB_PASS}'" >/dev/null
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -O "$APP_USER" "$DB_NAME"

log "Firewall: SSH (${SSH_PORT}), 80, 443"
ufw allow "${SSH_PORT}/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

log "pm2 starts on boot as ${APP_USER}"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "/home/${APP_USER}" >/dev/null

log "Provisioning complete for ${DOMAIN}"
