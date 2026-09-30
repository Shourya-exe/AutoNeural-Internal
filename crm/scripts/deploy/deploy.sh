#!/usr/bin/env bash
# Deploy this project to a Hostinger (or any Ubuntu) VPS.
#
#   VPS_HOST=203.0.113.10 ./scripts/deploy/deploy.sh
#
# Optional: DOMAIN (default demo.autoneural.in), SSH_PORT (22), SSH_KEY (~/.ssh/autoneural_deploy),
#           ADMIN_EMAIL (your login; created on the first deploy with a generated password).
#
# First run provisions the server (as root), then every run: sync code → write .env →
# install → migrate → build → (re)start CRM, worker and voice agent under pm2 → health check.
set -euo pipefail

VPS_HOST="${VPS_HOST:?set VPS_HOST to the server IP}"
DOMAIN="${DOMAIN:-demo.autoneural.in}"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/autoneural_deploy}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
APP_DIR="/var/www/autoneural-crm"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOY_DIR="$ROOT/.deploy"
mkdir -p "$DEPLOY_DIR" && chmod 700 "$DEPLOY_DIR"

SSH_OPTS=(-i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
ssh_root() { ssh "${SSH_OPTS[@]}" "root@${VPS_HOST}" "$@"; }
ssh_app() { ssh "${SSH_OPTS[@]}" "autoneural@${VPS_HOST}" "$@"; }
log() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }

log "Checking SSH access to ${VPS_HOST}:${SSH_PORT}"
ssh_root true

log "Provisioning (idempotent)"
scp -P "$SSH_PORT" -i "$SSH_KEY" -q "$ROOT/scripts/deploy/provision.sh" "root@${VPS_HOST}:/root/provision.sh"
ssh_root "DOMAIN='${DOMAIN}' SSH_PORT='${SSH_PORT}' bash /root/provision.sh"

log "Generating server environment"
DB_PASS="$(ssh_root cat /root/.autoneural-db-pass)"
node "$ROOT/scripts/deploy/make-env.mjs" "$DOMAIN" "$DB_PASS" "$DEPLOY_DIR/env.production"

log "Syncing code"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
  --exclude node_modules --exclude .next --exclude .localdb --exclude .venv-agent \
  --exclude logs --exclude __pycache__ --exclude .deploy --exclude .git --exclude .claude \
  --exclude .env --exclude '.env.local' --exclude tsconfig.tsbuildinfo --exclude .DS_Store \
  --exclude .uploads --exclude 'public/media/hero-skyline.mp4' \
  "$ROOT/" "autoneural@${VPS_HOST}:${APP_DIR}/"
scp -P "$SSH_PORT" -i "$SSH_KEY" -q "$DEPLOY_DIR/env.production" "autoneural@${VPS_HOST}:${APP_DIR}/.env"
if [ -f "$ROOT/service-account.json" ]; then
  scp -P "$SSH_PORT" -i "$SSH_KEY" -q "$ROOT/service-account.json" "autoneural@${VPS_HOST}:${APP_DIR}/service-account.json"
fi
ssh_app "chmod 600 ${APP_DIR}/.env ${APP_DIR}/service-account.json 2>/dev/null || true; mkdir -p ${APP_DIR}/logs"

log "Install, migrate, build"
ssh_app "cd ${APP_DIR} && npm ci --no-audit --no-fund && npx prisma migrate deploy && npm run build"

# First deploy only: demo data + a personal admin with a generated password.
if ! ssh_app "test -f ${APP_DIR}/.seeded"; then
  log "First deploy: seeding demo data"
  ssh_app "cd ${APP_DIR} && npm run db:seed && touch .seeded"
  if [ -n "$ADMIN_EMAIL" ]; then
    ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
    ssh_app "cd ${APP_DIR} && ADMIN_NAME='Admin' ADMIN_EMAIL='${ADMIN_EMAIL}' ADMIN_PASSWORD='${ADMIN_PASSWORD}' node scripts/create-admin.mjs >/dev/null"
    printf 'URL: https://%s\nEmail: %s\nPassword: %s\n' "$DOMAIN" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" > "$DEPLOY_DIR/admin-credentials.txt"
    chmod 600 "$DEPLOY_DIR/admin-credentials.txt"
    echo "Admin login saved to .deploy/admin-credentials.txt"
  fi
  # Seeded demo accounts use a password published in the repo — scramble them on a public server.
  ssh_app "cd ${APP_DIR} && node scripts/deploy/scramble-demo-passwords.mjs"
fi

log "Voice agent Python environment"
ssh_app "cd ${APP_DIR} && (test -d .venv-agent || python3 -m venv .venv-agent) && .venv-agent/bin/pip install -q --upgrade pip && .venv-agent/bin/pip install -q -r requirements.txt"

log "Starting processes under pm2"
ssh_app "cd ${APP_DIR} && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save"

log "Health check"
for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${DOMAIN}/api/health" || true)"
  [ "$code" = "200" ] && break
  sleep 5
done
echo "https://${DOMAIN}/api/health → ${code}"
ssh_app "pm2 ls"
[ "$code" = "200" ] || { echo "Health check did not return 200 — check DNS (A record for ${DOMAIN} → ${VPS_HOST}) and 'pm2 logs' on the server."; exit 1; }
log "Deployed: https://${DOMAIN}"
