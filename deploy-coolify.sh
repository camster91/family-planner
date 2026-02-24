#!/bin/bash

# Family Planner Coolify Deployment Script
# Follow these steps to deploy on Coolify

echo "🚀 Family Planner Coolify Deployment"
echo "===================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Must run from family-planner-app directory"
    exit 1
fi

echo ""
echo "Step 1: Create GitHub Repository"
echo "--------------------------------"
echo "Run these commands to create and push to GitHub:"
echo ""
echo "  # Initialize git if not already"
echo "  git init"
echo "  git add ."
echo "  git commit -m 'Initial commit: Family Planner Phase 1'"
echo ""
echo "  # Create GitHub repo (requires gh CLI)"
echo "  gh repo create camster91/family-planner --public --source=. --remote=origin --push"
echo ""
echo "  # Or manually create at: https://github.com/new"
echo "  # Then push:"
echo "  git remote add origin https://github.com/camster91/family-planner.git"
echo "  git branch -M main"
echo "  git push -u origin main"
echo ""

echo "Step 2: Create Coolify Application"
echo "----------------------------------"
echo "Use this curl command to create the app in Coolify:"
echo ""
echo 'curl -s -X POST -H "Authorization: Bearer 2|OyUt8feqoaBUVu1Uvvkq59CCqNjIdj4j2Vf0OXYf" \'
echo '  -H "Content-Type: application/json" \'
echo '  "http://187.77.26.99:8000/api/v1/applications/public" \'
echo '  -d '\''{
    "project_uuid": "hc4ocwo0sc4o8kkkwcogssgk",
    "environment_name": "production",
    "server_uuid": "b4gwko84g88ssgwk0wc8ks40",
    "git_repository": "https://github.com/camster91/family-planner",
    "git_branch": "main",
    "build_pack": "dockerfile",
    "ports_exposes": "3000",
    "name": "Family Planner"
}'\'
echo ""

echo "Step 3: Set Environment Variables"
echo "---------------------------------"
echo "After creating the app, set these environment variables in Coolify:"
echo ""
echo "  NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url"
echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key"
echo "  SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key (optional)"
echo "  NEXT_PUBLIC_APP_URL=https://family.ashbi.ca (or your domain)"
echo ""

echo "Step 4: Deploy"
echo "--------------"
echo "After setting variables, trigger deployment in Coolify dashboard or:"
echo ""
echo 'curl -s -X POST -H "Authorization: Bearer 2|OyUt8feqoaBUVu1Uvvkq59CCqNjIdj4j2Vf0OXYf" \'
echo '  "http://187.77.26.99:8000/api/v1/applications/{APP_UUID}/start"'
echo ""

echo "Step 5: Set Custom Domain (Optional)"
echo "------------------------------------"
echo "To use family.ashbi.ca or your own domain:"
echo ""
echo 'curl -s -X PATCH -H "Authorization: Bearer 2|OyUt8feqoaBUVu1Uvvkq59CCqNjIdj4j2Vf0OXYf" \'
echo '  -H "Content-Type: application/json" \'
echo '  "http://187.77.26.99:8000/api/v1/applications/{APP_UUID}" \'
echo '  -d '\''{"domains": "https://family.ashbi.ca"}'\'
echo ""

echo "🎉 Deployment Complete!"
echo "Your app will be available at: http://187.77.26.99:3000 (or your domain)"
echo ""
echo "📝 Next Steps:"
echo "1. Run database/setup.sql in Supabase SQL Editor"
echo "2. Test the application with sample data"
echo "3. Invite beta testers"
echo "4. Begin Phase 2 development"