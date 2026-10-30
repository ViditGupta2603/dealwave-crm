#!/bin/sh
set -e
echo "[entrypoint] running migrations"
node src/migrate.js
if [ "$SEED_DEMO" = "true" ]; then
  echo "[entrypoint] SEED_DEMO=true, loading demo data (only if the database has no workspaces yet)"
  node src/seed.js
fi
exec node src/server.js
