#!/bin/sh
set -e
# Apply pending database migrations before starting (safe to run on every boot).
/app/node_modules/.bin/prisma migrate deploy
exec "$@"
