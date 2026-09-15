#!/bin/bash
# Usage: activate.sh <base-dir> <release-dir-name> <https://domain>
# Makes LiteSpeed serve the new release on Hostinger Cloud. LiteSpeed keeps using an
# already-running app process and re-reads .htaccess with a delay, so this stops this app's
# processes from other releases (matched by working directory under <base-dir>;
# other sites on the account are never touched) and keeps requesting the site
# until the new release is running.
BASE="$1"
NEW="$BASE/$2"
URL="$3"

for attempt in $(seq 1 24); do
  running=0
  for pid in $(pgrep -u "$(id -u)" -f next-server 2>/dev/null); do
    dir=$(readlink "/proc/$pid/cwd" 2>/dev/null)
    dir=${dir% (deleted)}
    case "$dir" in
      "$BASE"/app-*)
        if [ "$dir" = "$NEW" ]; then
          running=1
        else
          kill "$pid" 2>/dev/null && echo "stopped old process $pid"
        fi
        ;;
    esac
  done
  if [ "$running" = 1 ]; then
    echo "Release $2 is serving (attempt $attempt)"
    exit 0
  fi
  curl -s -o /dev/null -m 30 "$URL/login" || true
  sleep 5
done

echo "Release $2 did not start within 2 minutes"
exit 1
