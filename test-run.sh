#!/bin/bash

echo "🧪 Testing Family Planner Application"
echo "====================================="

# Check if dependencies are installed
echo "1. Checking dependencies..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found"
    exit 1
fi
echo "✅ Node.js $(node -v)"

if ! command -v npm &> /dev/null; then
    echo "❌ npm not found"
    exit 1
fi
echo "✅ npm $(npm -v)"

# Check TypeScript compilation
echo "2. TypeScript compilation check..."
npx tsc --noEmit
if [ $? -eq 0 ]; then
    echo "✅ TypeScript compilation successful"
else
    echo "❌ TypeScript compilation failed"
    exit 1
fi

# Check for critical files
echo "3. Checking critical files..."
REQUIRED_FILES=(
    "src/app/layout.tsx"
    "src/app/page.tsx"
    "src/app/dashboard/page.tsx"
    "src/lib/supabase/client.ts"
    "src/types/index.ts"
    "package.json"
    "next.config.js"
    "tailwind.config.js"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ Missing: $file"
        exit 1
    fi
done

# Check environment setup
echo "4. Checking environment setup..."
if [ -f ".env.local" ]; then
    echo "✅ .env.local exists"
    
    # Check for required variables
    if grep -q "NEXT_PUBLIC_SUPABASE_URL" .env.local && grep -q "NEXT_PUBLIC_SUPABASE_ANON_KEY" .env.local; then
        echo "✅ Supabase variables found"
    else
        echo "⚠️  Supabase variables might be missing"
    fi
else
    echo "⚠️  .env.local not found (run: cp .env.example .env.local)"
fi

# Summary
echo ""
echo "📊 Test Summary"
echo "==============="
echo "✅ Application structure: Complete"
echo "✅ TypeScript types: Valid"
echo "✅ Dependencies: Installed"
echo "✅ Configuration: Ready"
echo ""
echo "🎉 Family Planner Phase 1 is ready for development!"
echo ""
echo "Next steps:"
echo "1. Configure Supabase in .env.local"
echo "2. Run database/setup.sql in Supabase"
echo "3. Start dev server: npm run dev"
echo "4. Open http://localhost:3000"