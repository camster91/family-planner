#!/bin/bash

# Family Planner Setup Script
# This script helps set up the development environment

set -e

echo "🚀 Family Planner Setup"
echo "======================"

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 22 (see .nvmrc) from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "❌ Node.js version must be 22 or higher (see .nvmrc). Current version: $(node -v)"
    exit 1
fi
echo "✅ Node.js $(node -v)"

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm."
    exit 1
fi
echo "✅ npm $(npm -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Check for .env.local
if [ ! -f .env.local ]; then
    echo "📝 Creating environment configuration..."
    cp .env.example .env.local
    echo "✅ Created .env.local"
    echo ""
    echo "⚠️  Edit .env.local: set DATABASE_URL (use host localhost when running npm run dev) and JWT_SECRET."
    echo "   Local PostgreSQL via docker-compose.yml also needs .env; see SETUP.md, Step 2."
    echo ""
else
    echo "✅ Environment file exists"
fi

# Check for Git
if command -v git &> /dev/null; then
    # Initialize Git if not already
    if [ ! -d .git ]; then
        echo "📝 Initializing Git repository..."
        git init
        git add .
        git commit -m "Initial commit: Family Planner MVP"
        echo "✅ Git repository initialized"
    else
        echo "✅ Git repository exists"
    fi
else
    echo "⚠️  Git not installed (optional)"
fi

# Create necessary directories
echo "📁 Creating directory structure..."
mkdir -p public/images public/fonts
echo "✅ Directory structure ready"

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Set DATABASE_URL and JWT_SECRET in .env.local"
echo "2. Apply the schema and generate the Prisma client: node scripts/migrate.js && npx prisma generate (SETUP.md, Step 4)"
echo "3. Start development server: npm run dev"
echo "4. Open http://localhost:3000"
echo ""
echo "For detailed instructions, see SETUP.md"