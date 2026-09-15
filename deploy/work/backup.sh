#!/bin/bash
# hPanel cron job (daily): consistent snapshot of the CRM database; keeps 30.
# VACUUM INTO is safe while the app is writing.
BASE="$HOME/autoneural-crm"
mkdir -p "$BASE/backups"
OUT="$BASE/backups/autoneural-crm-$(date -u +%Y-%m-%d-%H%M).sqlite"
/opt/alt/alt-nodejs24/root/bin/node -e 'new (require("node:sqlite").DatabaseSync)(process.argv[1]).exec("VACUUM INTO " + JSON.stringify(process.argv[2]).replace(/"/g, "\x27"))' \
  "$BASE/data/autoneural-crm.sqlite" "$OUT" 2>>"$BASE/logs/backup.log" && chmod 600 "$OUT"
ls -1t "$BASE/backups"/autoneural-crm-*.sqlite 2>/dev/null | tail -n +31 | xargs -r rm -f
