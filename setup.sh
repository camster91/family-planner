#!/bin/bash

# Family Planner Setup Script
# This script helps set up the development environment

set -e

echo "🚀 Family Planner Setup"
echo "======================"

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version must be 18 or higher. Current version: $(node -v)"
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
npm install

# Check for .env.local
if [ ! -f .env.local ]; then
    echo "📝 Creating environment configuration..."
    cp .env.example .env.local
    echo "✅ Created .env.local"
    echo ""
    echo "⚠️  IMPORTANT: You need to configure Supabase:"
    echo "1. Go to https://supabase.com and create a project"
    echo "2. Get your project URL and anon key"
    echo "3. Edit .env.local with your credentials"
    echo "4. Run database/setup.sql in Supabase SQL Editor"
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
echo "1. Configure Supabase in .env.local"
echo "2. Run database/setup.sql in Supabase SQL Editor"
echo "3. Start development server: npm run dev"
echo "4. Open http://localhost:3000"
echo ""
echo "For detailed instructions, see SETUP.md"