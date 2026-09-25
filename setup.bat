@echo off
echo 🚀 Family Planner Setup
echo ======================

REM Check for Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo ❌ Node.js is not installed. Please install Node.js 22 ^(see .nvmrc^) from https://nodejs.org/
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo ✅ Node.js %NODE_VERSION%

REM Check for npm
where npm >nul 2>nul
if errorlevel 1 (
    echo ❌ npm is not installed. Please install npm.
    exit /b 1
)

for /f "tokens=*" %%i in ('npm -v') do set NPM_VERSION=%%i
echo ✅ npm %NPM_VERSION%

REM Install dependencies
echo 📦 Installing dependencies...
call npm ci

REM Check for .env.local
if not exist .env.local (
    echo 📝 Creating environment configuration...
    copy .env.example .env.local
    echo ✅ Created .env.local
    echo.
    echo ⚠️  Edit .env.local: set DATABASE_URL ^(use host localhost when running npm run dev^) and JWT_SECRET.
    echo    Local PostgreSQL via docker-compose.yml also needs .env; see SETUP.md, Step 2.
    echo.
) else (
    echo ✅ Environment file exists
)

REM Create necessary directories
echo 📁 Creating directory structure...
if not exist public\images mkdir public\images
if not exist public\fonts mkdir public\fonts
echo ✅ Directory structure ready

echo.
echo 🎉 Setup complete!
echo.
echo Next steps:
echo 1. Set DATABASE_URL and JWT_SECRET in .env.local
echo 2. Apply the schema and generate the Prisma client: node scripts/migrate.js, then npx prisma generate (SETUP.md, Step 4)
echo 3. Start development server: npm run dev
echo 4. Open http://localhost:3000
echo.
echo For detailed instructions, see SETUP.md
pause