#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${APP_ENV:?APP_ENV is required}"
: "${DATABASE_ENV:?DATABASE_ENV is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
if [[ "$APP_ENV" != "$DATABASE_ENV" ]]; then
  echo "Database environment mismatch" >&2
  exit 1
fi
if [[ "$APP_ENV" != development && "$APP_ENV" != production ]]; then
  echo "Invalid APP_ENV" >&2
  exit 1
fi
if [[ "$BACKUP_DIR" != /* ]]; then
  echo "BACKUP_DIR must be an absolute path" >&2
  exit 1
fi
for command_name in psql pg_dump gpg; do
  command -v "$command_name" >/dev/null || {
    echo "Missing command: $command_name" >&2
    exit 1
  }
done

actual_env="$(psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c 'SELECT environment FROM deployment_identity WHERE id=1')"
if [[ "$actual_env" != "$APP_ENV" ]]; then
  echo "Database identity mismatch" >&2
  exit 1
fi

mkdir -p -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$BACKUP_DIR/billease-${APP_ENV}-${stamp}.dump.gpg"
if [[ -e "$final" ]]; then
  echo "Backup already exists: $final" >&2
  exit 1
fi
partial="$(mktemp "$BACKUP_DIR/.billease-backup-XXXXXXXX.partial")"
trap 'rm -f -- "$partial"' EXIT
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" |
  gpg --batch --yes --pinentry-mode loopback --cipher-algo AES256 \
    --passphrase-fd 3 --symmetric --output "$partial" 3<<<"$BACKUP_PASSPHRASE"
test -s "$partial"
mv -- "$partial" "$final"
trap - EXIT
echo "$final"
