#!/bin/sh
set -e

echo "=== Family Planner Container Startup ==="
echo "Current directory: $(pwd)"
echo "Listing files:"
ls -la
echo "=== Environment Variables ==="
echo "NODE_ENV: ${NODE_ENV:-not set}"
echo "PORT: ${PORT:-not set}"
echo "HOSTNAME: ${HOSTNAME:-not set}"
echo "NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL:-not set}"
echo "NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY:-not set}"
echo "NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:-not set}"
echo "=== Starting Next.js Server ==="

# Check if server.js exists
if [ -f "server.js" ]; then
    echo "Found server.js, starting Node.js server..."
    exec node server.js
else
    echo "ERROR: server.js not found!"
    echo "Contents of current directory:"
    ls -la
    exit 1
fi