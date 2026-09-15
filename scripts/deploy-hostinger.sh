#!/usr/bin/env bash
# ==============================================================================
# AutoNeural Cloud Deployment Script for Hostinger
# Supports deployment to any subdomain of autoneural.in (e.g., crm.autoneural.in)
#
# Usage:
#   ./scripts/deploy-hostinger.sh [subdomain] [options]
#
# Examples:
#   ./scripts/deploy-hostinger.sh                         # Deploys to crm.autoneural.in
#   ./scripts/deploy-hostinger.sh crm                     # Deploys to crm.autoneural.in
#   ./scripts/deploy-hostinger.sh work                    # Deploys to work.autoneural.in
#   ./scripts/deploy-hostinger.sh tasks                   # Deploys to tasks.autoneural.in
#   ./scripts/deploy-hostinger.sh crm --with-database     # First deploy: copy local database
#
# Environment variables (optional overrides):
#   DEPLOY_HOST       Hostinger SSH target (default: u294542559@145.79.213.25)
#   DEPLOY_PORT       Hostinger SSH port (default: 65002)
#   DEPLOY_KEY        Hostinger SSH private key (default: ~/.ssh/id_ed25519_ainova)
#   DEPLOY_DOMAIN     Full domain override (default: <subdomain>.autoneural.in)
#   DEPLOY_DOCROOT    Document root on Hostinger (default: domains/autoneural.in/public_html/<subdomain>)
# ==============================================================================

set -euo pipefail
cd "$(dirname "$0")/.."

# Parse arguments
SUBDOMAIN="crm"
WITH_DATABASE=false

for arg in "$@"; do
  case "$arg" in
    --with-database)
      WITH_DATABASE=true
      ;;
    --help|-h)
      echo "Usage: $0 [subdomain] [--with-database]"
      echo "  subdomain       Subdomain under autoneural.in (default: crm)"
      echo "  --with-database Copy local SQLite database on first setup"
      exit 0
      ;;
    *)
      if [[ ! "$arg" =~ ^-- ]]; then
        SUBDOMAIN="$arg"
      fi
      ;;
  esac
done

HOST="${DEPLOY_HOST:-u294542559@145.79.213.25}"
PORT="${DEPLOY_PORT:-65002}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_ainova}"
DOMAIN="${DEPLOY_DOMAIN:-${SUBDOMAIN}.autoneural.in}"
DOCROOT="${DEPLOY_DOCROOT:-domains/autoneural.in/public_html/${SUBDOMAIN}}"
NODE_BIN="/opt/alt/alt-nodejs24/root/bin/node"

SSH_OPTS=(-p "$PORT" -o BatchMode=yes)
if [ -f "$KEY" ]; then
  SSH_OPTS=(-i "$KEY" "${SSH_OPTS[@]}")
fi

SSH=(ssh "${SSH_OPTS[@]}" "$HOST")
SCP=(scp "${SSH_OPTS[@]}")

echo "============================================================"
echo "  Deploying AutoNeural to Hostinger Cloud"
echo "  Target Domain:  https://${DOMAIN}"
echo "  Subdomain:      ${SUBDOMAIN}"
echo "  Remote Host:    ${HOST}:${PORT}"
echo "  Document Root:  ${DOCROOT}"
echo "============================================================"

# Check SSH connection
echo "→ Checking SSH connectivity to Hostinger..."
REMOTE_HOME="$("${SSH[@]}" 'echo $HOME')" || {
  echo "✘ SSH connection failed. Check your host, key (${KEY}), and network."
  exit 1
}

BASE="$REMOTE_HOME/autoneural-${SUBDOMAIN}"
DB="$BASE/data/autoneural-crm.sqlite"
RELEASE="app-$(date +%Y%m%d%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ Building Next.js standalone bundle for production..."
NEXT_OUTPUT=standalone npm run build >"$WORK/build.log" 2>&1 || {
  echo "✘ Build failed! Last 30 lines of build log:"
  tail -n 30 "$WORK/build.log"
  exit 1
}

echo "→ Packaging release artifacts..."
cp -R .next/static .next/standalone/.next/
[ -d public ] && cp -R public .next/standalone/
cp deploy/passenger.js .next/standalone/passenger.js
rm -rf .next/standalone/.env* .next/standalone/data .next/standalone/output .next/standalone/archives
mkdir -p .next/standalone/tmp

COPYFILE_DISABLE=1 tar --no-xattrs -C .next/standalone -czf "$WORK/release.tgz" .

# Source snapshot on the server for disaster recovery
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$WORK/source.tgz" \
  src scripts tests deploy public package.json package-lock.json next.config.ts \
  tsconfig.json next-env.d.ts README.md AGENTS.md 2>/dev/null || true

echo "→ Preparing remote server directories at $BASE..."
"${SSH[@]}" "mkdir -p '$BASE/data' '$BASE/logs' '$BASE/backups' '$BASE/source' '$REMOTE_HOME/$DOCROOT' && chmod 700 '$BASE' '$BASE/data' '$BASE/backups'
  if [ ! -f '$BASE/.env.production' ]; then
    printf 'CRM_APP_URL=https://%s\nCRM_DATABASE_PATH=%s\n' '$DOMAIN' '$DB' >'$BASE/.env.production'
    chmod 600 '$BASE/.env.production'
  fi"

if [ "$WITH_DATABASE" = true ]; then
  echo "→ Preparing database transfer..."
  if [ -f "data/autoneural-crm.sqlite" ]; then
    "${SSH[@]}" "test ! -e '$DB'" || {
      echo "⚠ Server already has a database at $DB; refusing to overwrite. Remove it manually if intended."
      exit 1
    }
    node -e '
      const { DatabaseSync } = require("node:sqlite");
      new DatabaseSync(process.argv[1]).exec("VACUUM INTO " + JSON.stringify(process.argv[2]).replace(/"/g, "\x27"));
      const copy = new DatabaseSync(process.argv[2]);
      copy.exec("DELETE FROM sessions; DELETE FROM attempts;");
      copy.close();' "data/autoneural-crm.sqlite" "$WORK/crm.sqlite" 2>/dev/null || cp "data/autoneural-crm.sqlite" "$WORK/crm.sqlite"

    "${SCP[@]}" "$WORK/crm.sqlite" "$HOST:$DB"
    "${SSH[@]}" "chmod 600 '$DB'"
    echo "✓ Database transferred."
  else
    echo "⚠ Local data/autoneural-crm.sqlite not found. Remote app will start with fresh empty database."
  fi
fi

cat >"$WORK/htaccess" <<EOF
# AutoNeural CRM ($DOMAIN) served by LiteSpeed Passenger
PassengerAppRoot $BASE/$RELEASE
PassengerAppType node
PassengerNodejs $NODE_BIN
PassengerStartupFile passenger.js
PassengerBaseURI /
PassengerRestartDir $BASE/$RELEASE/tmp

RewriteEngine On
RewriteCond %{HTTPS} !=on
RewriteCond %{HTTP:X-Forwarded-Proto} !https
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
EOF

echo "→ Uploading release ${RELEASE} to Hostinger..."
"${SCP[@]}" "$WORK/release.tgz" "$HOST:$BASE/release.tgz"
"${SCP[@]}" "$WORK/source.tgz" "$HOST:$BASE/source/autoneural-src-${RELEASE#app-}.tgz"
"${SCP[@]}" "$WORK/htaccess" "$HOST:$BASE/htaccess.new"
"${SCP[@]}" deploy/activate.sh deploy/backup.sh "$HOST:$BASE/"

echo "→ Activating release on Hostinger..."
"${SSH[@]}" "set -e
  cd '$BASE'
  chmod 700 activate.sh backup.sh
  mkdir -p '$RELEASE' && tar -xzf release.tgz -C '$RELEASE' && rm -f release.tgz
  ln -sfn '$RELEASE' current
  cd '$REMOTE_HOME/$DOCROOT'
  if [ -f default.php ]; then mv default.php '$BASE/hostinger-default.php.bak'; fi
  mv '$BASE/htaccess.new' .htaccess"

echo "→ Restarting LiteSpeed Passenger processes..."
"${SSH[@]}" "bash '$BASE/activate.sh' '$BASE' '$RELEASE' 'https://$DOMAIN' && bash '$BASE/backup.sh' '$BASE'
  cd '$BASE' && ls -dt app-* 2>/dev/null | tail -n +4 | xargs -r rm -rf
  cd source && ls -1t autoneural-src-*.tgz 2>/dev/null | tail -n +6 | xargs -r rm -f"

echo "→ Verifying deployment at https://${DOMAIN}..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -m 30 "https://${DOMAIN}/login" || echo "failed")
if [[ "$HTTP_STATUS" =~ ^(200|302|307|308)$ ]]; then
  echo "============================================================"
  echo "✓ SUCCESS! AutoNeural is LIVE at https://${DOMAIN}"
  echo "  Release: ${RELEASE}"
  echo "============================================================"
else
  echo "⚠ Warning: https://${DOMAIN}/login returned HTTP status: ${HTTP_STATUS}"
  echo "  Check if DNS record for '${SUBDOMAIN}' is pointed to Hostinger IP."
fi
