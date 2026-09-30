#!/bin/bash
# Hostinger cron job: consistent snapshot of the SQLite database (keeps 30) and an
# archive of uploaded task files (keeps 7). VACUUM INTO is safe while the app is running.
# Usage: backup.sh <app-dir-name | absolute-app-dir>   e.g. backup.sh autoneural-crm
APP_NAME="${1:-autoneural-crm}"
case "$APP_NAME" in
  /*) BASE="$APP_NAME" ;;
  *) BASE="$HOME/$APP_NAME" ;;
esac
mkdir -p "$BASE/backups" "$BASE/logs"
STAMP="$(date -u +%Y-%m-%d-%H%M)"
OUT="$BASE/backups/crm-backup-$STAMP.sqlite"

NODE_BIN="/opt/alt/alt-nodejs24/root/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(which node 2>/dev/null || echo "node")"
fi

if [ -f "$BASE/data/autoneural-crm.sqlite" ]; then
  "$NODE_BIN" -e 'new (require("node:sqlite").DatabaseSync)(process.argv[1]).exec("VACUUM INTO " + JSON.stringify(process.argv[2]).replace(/"/g, "\x27"))' \
    "$BASE/data/autoneural-crm.sqlite" "$OUT" 2>>"$BASE/logs/backup.log" && chmod 600 "$OUT"
  ls -1t "$BASE/backups"/crm-backup-*.sqlite 2>/dev/null | tail -n +31 | xargs -r rm -f
fi

# Uploaded files live next to the database unless CRM_UPLOAD_DIR points elsewhere.
UPLOADS="${CRM_UPLOAD_DIR:-$BASE/data/uploads}"
if [ -d "$UPLOADS" ]; then
  tar -czf "$BASE/backups/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")" 2>>"$BASE/logs/backup.log" \
    && chmod 600 "$BASE/backups/uploads-$STAMP.tar.gz"
  ls -1t "$BASE/backups"/uploads-*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
fi
