#!/bin/sh
set -e

echo "=== Family Planner Container Startup ==="

# Set NODE_PATH to include global modules (for pg package)
export NODE_PATH="/usr/lib/node_modules:$NODE_PATH"

# Release identity fallback. The image normally bakes RELEASE_SHA in at build
# time. If it is empty and the platform provides SOURCE_COMMIT at runtime
# (Coolify can), use that so /api/health and /api/version still name the commit.
if [ -z "${RELEASE_SHA:-}" ] && [ -n "${SOURCE_COMMIT:-}" ]; then
  export RELEASE_SHA="$SOURCE_COMMIT"
fi

# Run database migration if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
  echo "Running database migration..."
  node /app/scripts/migrate.js
else
  echo "WARNING: DATABASE_URL not set, skipping migration"
fi

echo "Starting Next.js server..."
exec node server.js
