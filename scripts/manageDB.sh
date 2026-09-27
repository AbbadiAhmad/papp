#!/usr/bin/env bash
#
# manageDB.sh — restore the papp database from a backup archive
# (docs/DECISIONS.md D43 resolution). Modeled on the user's own Research-Hub
# platform script.
#
# There is no `export` command here: exporting is the HTTP-only path —
# an admin uses the web UI's "Export backup" page (permission-gated by
# `backup.export`) or calls `POST /backup/export` directly, both backed by
# BackupService. Restore is the opposite: intentionally NEVER available over
# HTTP. A full restore needs an exclusive Postgres lock that queues behind
# (and queues other requests behind) any connection the running app's own
# Prisma pool holds — that's what made the reference implementation's whole
# app, including login, hang when restore was attempted through its own HTTP
# API. This script runs entirely outside the app process, via `docker compose
# exec`, so a restore can never make the running app unresponsive.
#
# Usage:
#   ./scripts/manageDB.sh restore FILE
#
# FILE is the AES-encrypted .zip produced by an export (web UI's "Export
# backup" button, or POST /backup/export), or a raw, unencrypted .sql dump.
# Runs inside the `api` container so it always uses the same
# DATABASE_URL/BACKUP_ENCRYPTION_PASSWORD the running app itself uses.
set -euo pipefail

usage() {
  sed -n '/^# Usage:/,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
  exit 1
}

[[ $# -ge 2 && "$1" == "restore" ]] || usage
FILE="$2"
[[ -f "$FILE" ]] || { echo "File not found: $FILE" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

# Piped to the container's stdin, restored to a temp file inside the
# container by cli-db.ts before the actual restore runs.
docker compose exec -T api sh -c 'cat > /tmp/papp-restore-input && node dist/cli-db.js restore /tmp/papp-restore-input; rm -f /tmp/papp-restore-input' < "$FILE"
echo "Restore finished."
