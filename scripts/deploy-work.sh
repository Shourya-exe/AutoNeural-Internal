#!/usr/bin/env bash
# Deploys the AutoNeural Team CRM to https://work.autoneural.in
# (Hostinger shared hosting: LiteSpeed + Passenger, Node 24).
#
#   scripts/deploy-work.sh                  # build and deploy code
#   scripts/deploy-work.sh --with-database  # first deploy only: copy the local
#       data/autoneural-crm.sqlite (accounts and tasks) to the server; refuses
#       if the server already has a database
#
# Server layout (~/autoneural-crm): current -> app-<timestamp>, data/, backups/,
# logs/, .env.production (CRM_APP_URL, CRM_DATABASE_PATH). Code deploys only
# add a release directory, so the database survives redeploys.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${DEPLOY_HOST:-u294542559@145.79.213.25}"
PORT="${DEPLOY_PORT:-65002}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_ainova}"
DOMAIN="${DEPLOY_DOMAIN:-work.autoneural.in}"
DOCROOT="${DEPLOY_DOCROOT:-domains/autoneural.in/public_html/work}"
NODE_BIN="/opt/alt/alt-nodejs24/root/bin/node"
SSH=(ssh -i "$KEY" -p "$PORT" -o BatchMode=yes "$HOST")
SCP=(scp -i "$KEY" -P "$PORT" -o BatchMode=yes)

REMOTE_HOME="$("${SSH[@]}" 'echo $HOME')"
BASE="$REMOTE_HOME/autoneural-crm"
DB="$BASE/data/autoneural-crm.sqlite"
RELEASE="app-$(date +%Y%m%d%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ Building standalone bundle"
NEXT_OUTPUT=standalone npm run build >"$WORK/build.log" 2>&1 || { tail -30 "$WORK/build.log"; exit 1; }
cp -R .next/static .next/standalone/.next/
[ -d public ] && cp -R public .next/standalone/
cp deploy/work/passenger.js .next/standalone/
rm -rf .next/standalone/.env* .next/standalone/data .next/standalone/output .next/standalone/archives
mkdir -p .next/standalone/tmp
COPYFILE_DISABLE=1 tar --no-xattrs -C .next/standalone -czf "$WORK/release.tgz" .
# Source snapshot on the server, so the app can be rebuilt without this machine.
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$WORK/source.tgz" \
  src scripts tests deploy public package.json package-lock.json next.config.ts \
  tsconfig.json next-env.d.ts README.md AGENTS.md CLAUDE.md 2>/dev/null

"${SSH[@]}" "mkdir -p '$BASE/data' '$BASE/logs' '$BASE/backups' '$BASE/source' && chmod 700 '$BASE' '$BASE/data' '$BASE/backups'
  if [ ! -f '$BASE/.env.production' ]; then
    printf 'CRM_APP_URL=https://%s\nCRM_DATABASE_PATH=%s\n' '$DOMAIN' '$DB' >'$BASE/.env.production'
    chmod 600 '$BASE/.env.production'
  fi"

if [[ "${1:-}" == "--with-database" ]]; then
  echo "→ Copying local database (accounts and tasks)"
  "${SSH[@]}" "test ! -e '$DB'" || { echo "Server already has a database; not overwriting it."; exit 1; }
  # Consistent snapshot even while the local server is running; local sessions
  # and login-throttle counters are not carried over.
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    new DatabaseSync(process.argv[1]).exec("VACUUM INTO " + JSON.stringify(process.argv[2]).replace(/"/g, "\x27"));
    const copy = new DatabaseSync(process.argv[2]);
    copy.exec("DELETE FROM sessions; DELETE FROM attempts;");
    copy.close();' "data/autoneural-crm.sqlite" "$WORK/crm.sqlite" 2>/dev/null
  "${SCP[@]}" "$WORK/crm.sqlite" "$HOST:$DB"
  "${SSH[@]}" "chmod 600 '$DB'"
fi
"${SSH[@]}" "test -e '$DB'" || echo "⚠ No database on the server yet: the app will start empty with no accounts."

cat >"$WORK/htaccess" <<EOF
# AutoNeural Team CRM (Next.js) served by Passenger. Managed by scripts/deploy-work.sh.
# The app root is the release directory itself: LiteSpeed resolves it when it
# spawns the process, so a new path is what starts a new version.
PassengerAppRoot $BASE/$RELEASE
PassengerAppType node
PassengerNodejs $NODE_BIN
PassengerStartupFile passenger.js
PassengerBaseURI /
PassengerRestartDir $BASE/$RELEASE/tmp
# Own rewrite rules, so the parent site's SPA fallback does not apply here.
RewriteEngine On
RewriteCond %{HTTPS} !=on
RewriteCond %{HTTP:X-Forwarded-Proto} !https
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
EOF

echo "→ Uploading release $RELEASE"
"${SCP[@]}" "$WORK/release.tgz" "$HOST:$BASE/release.tgz"
"${SCP[@]}" "$WORK/source.tgz" "$HOST:$BASE/source/autoneural-crm-src-${RELEASE#app-}.tgz"
"${SCP[@]}" "$WORK/htaccess" "$HOST:$BASE/htaccess.new"
"${SCP[@]}" deploy/work/activate.sh deploy/work/backup.sh "$HOST:$BASE/"
"${SSH[@]}" "set -e
  cd '$BASE'
  chmod 700 activate.sh backup.sh
  mkdir '$RELEASE' && tar -xzf release.tgz -C '$RELEASE' && rm release.tgz
  ln -sfn '$RELEASE' current
  cd '$REMOTE_HOME/$DOCROOT'
  if [ -f default.php ]; then mv default.php '$BASE/hostinger-default.php.bak'; fi
  mv '$BASE/htaccess.new' .htaccess"
"${SSH[@]}" "bash '$BASE/activate.sh' '$BASE' '$RELEASE' 'https://$DOMAIN' && bash '$BASE/backup.sh'
  cd '$BASE' && ls -dt app-* | tail -n +4 | xargs -r rm -rf
  cd source && ls -1t autoneural-crm-src-*.tgz | tail -n +6 | xargs -r rm -f"

echo "→ Verifying https://$DOMAIN"
missing=0
for asset in $(curl -s -m 30 "https://$DOMAIN/login" | grep -oE '_next/static/chunks/[A-Za-z0-9_.~-]+\.(js|css)' | sort -u); do
  [ -f ".next/standalone/.next/static/chunks/$(basename "$asset")" ] || missing=1
done
if [ "$missing" = 0 ]; then echo "✓ https://$DOMAIN serves release $RELEASE"; else echo "✘ https://$DOMAIN is not serving the new build"; exit 1; fi
