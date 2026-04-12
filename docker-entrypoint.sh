#!/bin/sh
set -e

echo "=== Family Planner Container Startup ==="

# Set NODE_PATH to include global modules (for pg package)
export NODE_PATH="/usr/lib/node_modules:$NODE_PATH"

# Run database migration if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
  echo "Running database migration..."
  node /app/scripts/migrate.js || echo "WARNING: Migration had issues, continuing anyway..."
else
  echo "WARNING: DATABASE_URL not set, skipping migration"
fi

echo "Starting Next.js server..."
exec node server.js