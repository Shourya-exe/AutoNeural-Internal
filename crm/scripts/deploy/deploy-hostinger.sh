#!/usr/bin/env bash
# Deploy/update demo.autoneural.in on Hostinger Cloud (shared hosting, Phusion Passenger).
#
#   ./scripts/deploy/deploy-hostinger.sh
#
# Hostinger Cloud can't `npm install` or build (per-account process limits → EAGAIN), so the
# app is built HERE as a Next.js standalone bundle (with Prisma's Linux engine) and uploaded.
# The server side (subdomain folder .htaccess, cron script, Supabase database) was set up once;
# see docs/DEPLOYMENT.md → "Hostinger Cloud demo (demo.autoneural.in)".
#
# Needs: ~/.ssh/autoneural_deploy authorised in hPanel, .deploy/env.demo-hostinger (generated
# by make-env.mjs with EXTRA_OVERRIDES for Supabase), service-account.json.
set -euo pipefail

SSH_USER="${SSH_USER:-u294542559}"
SSH_HOST="${SSH_HOST:-145.79.213.25}"
SSH_PORT="${SSH_PORT:-65002}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/autoneural_deploy}"
DOMAIN="${DOMAIN:-demo-crm.autoneural.in}"
REMOTE_APP="/home/${SSH_USER}/autoneural-demo-app"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.deploy/env.demo-hostinger"
BUILD="$(mktemp -d "${TMPDIR:-/tmp}/demo-build.XXXXXX")"
SSH=(ssh -i "$SSH_KEY" -p "$SSH_PORT" -o BatchMode=yes "${SSH_USER}@${SSH_HOST}")
log() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
trap 'rm -rf "$BUILD"' EXIT

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }

log "Cloning project into a separate build directory (keeps the dev server's .next intact)"
rsync -a --exclude node_modules --exclude .next --exclude .localdb --exclude .venv-agent --exclude logs \
  --exclude __pycache__ --exclude .git --exclude .claude --exclude tsconfig.tsbuildinfo --exclude .DS_Store \
  --exclude .deploy --exclude .env "$ROOT/" "$BUILD/"
cp -cR "$ROOT/node_modules" "$BUILD/node_modules" 2>/dev/null || cp -R "$ROOT/node_modules" "$BUILD/node_modules"
# Build-time copy without server-only runtime settings: PRISMA_QUERY_ENGINE_LIBRARY points at
# a path that only exists on the server, which made Prisma error while pages were collected.
grep -vE '^(PRISMA_QUERY_ENGINE_LIBRARY|TOKIO_WORKER_THREADS)=' "$ENV_FILE" > "$BUILD/.env.production"

log "Building standalone bundle"
(cd "$BUILD" && npx prisma generate >/dev/null && NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production npx next build)

log "Assembling package"
S="$BUILD/.next/standalone"
rm -rf "$S/node_modules/@img/sharp-darwin-"* "$S/node_modules/@img/sharp-libvips-darwin-"* \
  "$S/node_modules/.prisma/client/"libquery_engine-darwin*
cp -R "$BUILD/.next/static" "$S/.next/static"
cp -R "$BUILD/public" "$S/public"
rm -f "$S/public/media/hero-skyline.mp4"
cp "$ENV_FILE" "$S/.env.production"
[ -f "$ROOT/service-account.json" ] && cp "$ROOT/service-account.json" "$S/service-account.json"
cat > "$S/passenger.js" <<'EOF'
/** Hostinger / Passenger entry: load .env.production, then start Next's standalone server. */
const { join } = require("node:path");
process.loadEnvFile(join(__dirname, ".env.production"));
process.env.NODE_ENV = "production";
require("./server.js");
EOF
mkdir -p "$S/tmp"

log "Uploading (cron-sweep.sh and tmp/ on the server are preserved)"
rsync -az --delete --exclude cron-sweep.sh --exclude tmp --exclude .venv-agent --exclude start-agent.sh \
  -e "ssh -i $SSH_KEY -p $SSH_PORT -o BatchMode=yes" \
  "$S/" "${SSH_USER}@${SSH_HOST}:${REMOTE_APP}/"
"${SSH[@]}" "chmod 600 ${REMOTE_APP}/.env.production ${REMOTE_APP}/service-account.json 2>/dev/null; mkdir -p ${REMOTE_APP}/tmp && touch ${REMOTE_APP}/tmp/restart.txt"

log "Setting up voice agent (Python venv + deps)"
scp -i "$SSH_KEY" -P "$SSH_PORT" -o BatchMode=yes \
  "$ROOT/requirements.txt" "$ROOT/voice_config.py" "$ROOT/whatsapp_sender.py" \
  "${SSH_USER}@${SSH_HOST}:${REMOTE_APP}/"
"${SSH[@]}" "
  cd ${REMOTE_APP}
  PYTHON=/opt/alt/python311/bin/python3.11
  if [ ! -f .venv-agent/bin/activate ]; then
    \$PYTHON -m venv .venv-agent
    .venv-agent/bin/pip install --upgrade pip setuptools wheel >/dev/null 2>&1
  fi
  .venv-agent/bin/pip install -q -r requirements.txt 2>&1 | tail -3
"

log "Restarting voice agent"
"${SSH[@]}" "cd ${REMOTE_APP} && ./start-agent.sh restart 2>&1 || true"

log "Health check"
for i in $(seq 1 20); do
  body="$(curl -s --max-time 60 "https://${DOMAIN}/api/health" || curl -s --max-time 60 -H 'X-Forwarded-Proto: https' "http://${DOMAIN}/api/health" || true)"
  echo "$body" | grep -q '"database":"ok"' && break
  sleep 5
done
echo "$body"
echo "$body" | grep -q '"database":"ok"' || { echo "Health check failed"; exit 1; }
if curl -s -o /dev/null --max-time 20 "https://${DOMAIN}/api/health"; then
  log "Deployed https://${DOMAIN}"
else
  log "Deployed, but HTTPS is NOT working yet for ${DOMAIN} (checked over plain HTTP)."
  echo "  Install the free SSL for ${DOMAIN} in hPanel → Websites → autoneural.in → Security → SSL."
fi
