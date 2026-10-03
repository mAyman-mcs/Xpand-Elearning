#!/bin/sh
# Nightly database backup: pg_dump (custom format, compressed) → ./backups, then S3 if configured.
# Cron (as the deploy user), e.g.:  15 2 * * *  cd /opt/xpand && ops/backup.sh >> backups/backup.log 2>&1
# S3 retention is a bucket lifecycle rule (e.g. expire after 30 days); local copies are kept 7 days.
set -eu

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups
OUT="backups/xpand-${STAMP}.dump"

docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner > "$OUT"

# A dump that cannot be listed is corrupt; fail loudly rather than keep it.
docker compose -f "$COMPOSE_FILE" exec -T db pg_restore --list < "$OUT" > /dev/null
echo "backup written: $OUT ($(wc -c < "$OUT") bytes)"

if [ -n "${BACKUP_S3_URI:-}" ]; then
  aws s3 cp "$OUT" "${BACKUP_S3_URI%/}/$(basename "$OUT")" --only-show-errors
  echo "uploaded to ${BACKUP_S3_URI%/}/$(basename "$OUT")"
fi

find backups -name 'xpand-*.dump' -mtime +7 -delete
