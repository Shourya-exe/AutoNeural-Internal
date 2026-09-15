#!/bin/bash
# Hostinger cron job: consistent snapshot of the SQLite database; keeps 30 backups.
# VACUUM INTO is completely safe while the app is actively running.
APP_NAME="${1:-autoneural-crm}"
BASE="$HOME/$APP_NAME"
mkdir -p "$BASE/backups" "$BASE/logs"
OUT="$BASE/backups/crm-backup-$(date -u +%Y-%m-%d-%H%M).sqlite"

NODE_BIN="/opt/alt/alt-nodejs24/root/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(which node 2>/dev/null || echo "node")"
fi

if [ -f "$BASE/data/autoneural-crm.sqlite" ]; then
  "$NODE_BIN" -e 'new (require("node:sqlite").DatabaseSync)(process.argv[1]).exec("VACUUM INTO " + JSON.stringify(process.argv[2]).replace(/"/g, "\x27"))' \
    "$BASE/data/autoneural-crm.sqlite" "$OUT" 2>>"$BASE/logs/backup.log" && chmod 600 "$OUT"
  ls -1t "$BASE/backups"/crm-backup-*.sqlite 2>/dev/null | tail -n +31 | xargs -r rm -f
fi
