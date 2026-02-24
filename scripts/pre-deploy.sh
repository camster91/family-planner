#!/bin/bash

echo "🔍 Running Family Planner pre-deployment validation..."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ $2${NC}"
    else
        echo -e "${RED}✗ $2${NC}"
        exit 1
    fi
}

# 1. Check Node version
echo "1. Checking Node version..."
REQUIRED_NODE="^20.0.0"
CURRENT_NODE=$(node --version | cut -d'v' -f2)
if [[ "$CURRENT_NODE" =~ ^20\. ]]; then
    echo -e "${GREEN}✓ Node version $CURRENT_NODE is compatible${NC}"
else
    echo -e "${RED}✗ Node version $CURRENT_NODE is not compatible (requires 20.x)${NC}"
    echo -e "${YELLOW}  Update your .nvmrc or Dockerfile to use node:20-alpine${NC}"
fi

# 2. Validate Prisma schema
echo "2. Validating Prisma schema..."
npx prisma validate > /dev/null 2>&1
print_status $? "Prisma schema validation"

# 3. Generate Prisma client
echo "3. Generating Prisma client..."
npx prisma generate > /dev/null 2>&1
print_status $? "Prisma client generation"

# 4. TypeScript compilation check
echo "4. Checking TypeScript compilation..."
npx tsc --noEmit > /dev/null 2>&1
print_status $? "TypeScript compilation"

# 5. Check environment variables
echo "5. Checking required environment variables..."
REQUIRED_VARS=(
    "NEXT_PUBLIC_SUPABASE_URL"
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    "NEXT_PUBLIC_APP_URL"
)

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ] && [ ! -f ".env.production" ]; then
        echo -e "${YELLOW}⚠  $var is not set (will need to be set in Coolify)${NC}"
    fi
done

# 6. Test build locally (skip if takes too long)
echo "6. Testing Next.js build..."
if [ "$SKIP_BUILD_TEST" != "true" ]; then
    npm run build > /dev/null 2>&1
    print_status $? "Next.js build test"
else
    echo -e "${YELLOW}⚠  Build test skipped (set SKIP_BUILD_TEST=false to enable)${NC}"
fi

# 7. Check Dockerfile syntax
echo "7. Checking Dockerfile..."
if [ -f "Dockerfile" ]; then
    if grep -q "node:20-alpine" Dockerfile; then
        echo -e "${GREEN}✓ Dockerfile uses Node 20${NC}"
    else
        echo -e "${RED}✗ Dockerfile does not use Node 20${NC}"
    fi
    
    if grep -q "npx prisma generate" Dockerfile; then
        echo -e "${GREEN}✓ Dockerfile includes Prisma generation${NC}"
    else
        echo -e "${RED}✗ Dockerfile missing Prisma generation${NC}"
    fi
else
    echo -e "${RED}✗ Dockerfile not found${NC}"
fi

# 8. Check for any security vulnerabilities
echo "8. Checking for security issues..."
npm audit --production --audit-level=high > /dev/null 2>&1
AUDIT_STATUS=$?
if [ $AUDIT_STATUS -eq 0 ]; then
    echo -e "${GREEN}✓ No high severity vulnerabilities${NC}"
elif [ $AUDIT_STATUS -eq 1 ]; then
    echo -e "${YELLOW}⚠  High severity vulnerabilities found (check with 'npm audit')${NC}"
else
    echo -e "${YELLOW}⚠  Audit check failed${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Pre-deployment validation complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "1. Set environment variables in Coolify:"
echo "   - NEXT_PUBLIC_SUPABASE_URL"
echo "   - NEXT_PUBLIC_SUPABASE_ANON_KEY"
echo "   - NEXT_PUBLIC_APP_URL (https://family.ashbi.ca)"
echo "   - SUPABASE_SERVICE_ROLE_KEY (optional)"
echo "2. Run database migrations in Supabase:"
echo "   - database/setup.sql"
echo "   - database/updates.sql"
echo "   - database/phase2-updates.sql"
echo "3. Trigger deployment in Coolify"
echo "4. Monitor deployment logs"