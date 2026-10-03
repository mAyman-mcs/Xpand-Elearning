#!/bin/sh
# Proves a backup can be restored: loads it into a throwaway Postgres container and checks it.
# Run once per release (docs/DEPLOY.md). Usage:
#   ops/restore-test.sh backups/xpand-20261002T021500Z.dump
#   ops/restore-test.sh s3://bucket/xpand-portal/xpand-20261002T021500Z.dump
set -eu

SRC="${1:?usage: ops/restore-test.sh <dump file or s3:// uri>}"
WORK="$(mktemp -d)"
NAME="xpand-restore-test-$$"
trap 'docker rm -f "$NAME" > /dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

case "$SRC" in
  s3://*) aws s3 cp "$SRC" "$WORK/backup.dump" --only-show-errors ;;
  *) cp "$SRC" "$WORK/backup.dump" ;;
esac

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=restore postgres:17 > /dev/null
i=0
until docker exec "$NAME" pg_isready -U postgres -d restore > /dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { echo "postgres did not start"; exit 1; }; sleep 1
done
# The image's init can briefly restart the server; wait for a real query to succeed.
until docker exec "$NAME" psql -U postgres -d restore -tAc 'SELECT 1' > /dev/null 2>&1; do sleep 1; done

docker exec -i "$NAME" pg_restore -U postgres -d restore --no-owner --exit-on-error < "$WORK/backup.dump"

q() { docker exec "$NAME" psql -U postgres -d restore -tAc "$1"; }
echo "migrations applied: $(q 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
echo "users:              $(q 'SELECT count(*) FROM "User"')"
echo "super admins:       $(q "SELECT count(*) FROM \"User\" WHERE role = 'SUPER_ADMIN' AND \"isActive\"")"
echo "exams:              $(q 'SELECT count(*) FROM "Exam"')"
echo "assignments:        $(q 'SELECT count(*) FROM "Assignment"')"
echo "audit entries:      $(q 'SELECT count(*) FROM "AuditLog"')"

[ "$(q 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')" -gt 0 ] || { echo "FAIL: no migrations"; exit 1; }
echo "RESTORE TEST PASSED"
