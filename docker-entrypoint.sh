#!/bin/sh
set -e

echo "=== Family Planner Container Startup ==="

# Run Prisma schema push if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
  echo "Pushing database schema..."
  npx prisma db push --accept-data-loss 2>&1 || echo "WARNING: Schema push failed, continuing anyway..."
else
  echo "WARNING: DATABASE_URL not set, skipping schema push"
fi

echo "Starting Next.js server..."
exec node server.js