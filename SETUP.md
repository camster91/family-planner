# Family Planner - Setup Guide

## Prerequisites

1. **Node.js 20+** - [Download](https://nodejs.org/)
2. **Git** - [Download](https://git-scm.com/)
3. **PostgreSQL** - Local install, Docker, or a managed instance
4. **Code Editor** - VS Code recommended

## Step 1: Clone and Install

```bash
# Clone the project
git clone https://github.com/camster91/family-planner.git
cd family-planner

# Install dependencies
npm ci --legacy-peer-deps
```

## Step 2: PostgreSQL Setup

You need a running PostgreSQL instance. Options:

**Option A: Docker (quickest)**
```bash
docker run -d --name family-planner-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=family_planner \
  -p 5432:5432 \
  postgres:16-alpine
```

**Option B: Local PostgreSQL**
Create a database named `family_planner` in your local PostgreSQL instance.

**Option C: Managed (e.g., Neon, Railway, Supabase Postgres)**
Use the connection string provided by your host.

## Step 3: Environment Configuration

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```env
# PostgreSQL connection string (required)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/family_planner

# JWT secret for authentication (required)
JWT_SECRET=your-secret-key-at-least-32-characters

# App URL (optional, defaults to http://localhost:3000)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Step 4: Database Setup with Prisma

```bash
# Generate the Prisma client
npx prisma generate

# Push the schema to your database
npx prisma db push
```

This creates all required tables (User, Family, Chore, Event, Message, Reward, Notification, etc.) based on `prisma/schema.prisma`.

## Step 5: Run the Application

```bash
# Development mode
npm run dev

# Open http://localhost:3000
```

## Step 6: Create Your First Family

1. Open http://localhost:3000
2. Click "Start Free Trial"
3. Register with your email
4. Create your first family
5. Invite family members

## Development Workflow

### Daily Development
```bash
npm run dev          # Start dev server (port 3000)
npm run lint         # ESLint
npm run type-check   # TypeScript type checking (tsc --noEmit)
npm run format       # Prettier
npm run validate     # Type-check + Prisma validate
npm test             # Jest (runs with --passWithNoTests)
```

### Database Changes
```bash
# Edit prisma/schema.prisma, then:
npx prisma db push     # Push schema to database
npx prisma generate    # Regenerate Prisma client
npx prisma studio      # Browse data in browser GUI
```

### Git Workflow
```bash
git checkout -b feature/new-feature
# Make changes
git add .
git commit -m "Add new feature"
git push origin feature/new-feature
```

## Project Structure

```
family-planner/
├── src/app/              # Next.js App Router pages & API routes
├── src/components/       # React components by feature
├── src/lib/              # Utilities (auth, prisma, constants, utils)
├── src/types/            # TypeScript type definitions
├── prisma/               # Prisma schema
├── database/             # SQL migration files
├── public/               # Static assets
└── .github/workflows/    # CI/CD (GitHub Actions -> Coolify)
```

## Key Files

- `src/middleware.ts` - Auth middleware (JWT cookie check, protects /dashboard/*)
- `src/lib/auth.ts` - JWT sign/verify, bcrypt hash/compare
- `src/lib/prisma.ts` - Prisma client singleton
- `src/lib/constants.ts` - App constants, roles, feature flags
- `prisma/schema.prisma` - Database schema

## Authentication

The app uses self-hosted JWT authentication:
- **Registration/Login**: API routes at `/api/auth/register` and `/api/auth/login`
- **Session**: JWT stored in a `session_token` cookie
- **Middleware**: Protects all `/dashboard/*` routes, redirects to login if no valid token
- **Roles**: `parent` (admin), `teen`, `child`

## Common Issues

### 1. Database Connection Errors
- Verify `DATABASE_URL` in `.env.local` is correct
- Ensure PostgreSQL is running and accessible
- Run `npx prisma db push` to sync schema

### 2. Prisma Client Errors
- Run `npx prisma generate` after any schema change
- Clear `.next` directory if you see stale client errors

### 3. Build Errors
- Clear `.next` directory: `rm -rf .next`
- Reinstall dependencies: `rm -rf node_modules && npm ci --legacy-peer-deps`
- Check TypeScript errors: `npm run type-check`

### 4. Auth Issues
- Ensure `JWT_SECRET` is set in `.env.local`
- Clear cookies if you get persistent 401 errors

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Zustand Documentation](https://github.com/pmndrs/zustand)
- [React Hook Form Documentation](https://react-hook-form.com/)
