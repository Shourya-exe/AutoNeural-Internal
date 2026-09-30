#!/bin/bash
# hPanel cron job (daily): consistent snapshot of the CRM database (keeps 30) and an
# archive of uploaded task files (keeps 7). VACUUM INTO is safe while the app is writing.
BASE="$HOME/autoneural-crm"
mkdir -p "$BASE/backups" "$BASE/logs"
STAMP="$(date -u +%Y-%m-%d-%H%M)"
OUT="$BASE/backups/autoneural-crm-$STAMP.sqlite"
/opt/alt/alt-nodejs24/root/bin/node -e 'new (require("node:sqlite").DatabaseSync)(process.argv[1]).exec("VACUUM INTO " + JSON.stringify(process.argv[2]).replace(/"/g, "\x27"))' \
  "$BASE/data/autoneural-crm.sqlite" "$OUT" 2>>"$BASE/logs/backup.log" && chmod 600 "$OUT"
ls -1t "$BASE/backups"/autoneural-crm-*.sqlite 2>/dev/null | tail -n +31 | xargs -r rm -f

UPLOADS="${CRM_UPLOAD_DIR:-$BASE/data/uploads}"
if [ -d "$UPLOADS" ]; then
  tar -czf "$BASE/backups/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")" 2>>"$BASE/logs/backup.log" \
    && chmod 600 "$BASE/backups/uploads-$STAMP.tar.gz"
  ls -1t "$BASE/backups"/uploads-*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
fi
