# CLAUDE.md - Family Planner App

## Project Overview

Family Planner is a full-stack web app for family organization: chore tracking with a points/rewards system, shared calendar, family messaging, shared lists, and analytics. Built with Next.js 14 (App Router), TypeScript, Prisma 7, and PostgreSQL. Deployed via Docker to Coolify.

## Tech Stack

- **Framework**: Next.js 14.2.5 (App Router, `output: 'standalone'`)
- **Language**: TypeScript (strict mode, `noImplicitAny: false`)
- **Database**: PostgreSQL via Prisma 7 ORM
- **Auth**: Self-hosted JWT (bcryptjs + jsonwebtoken) — migrated from Supabase
- **Styling**: Tailwind CSS 3.4 with `clsx` + `tailwind-merge` (`cn()` helper in `src/lib/utils.ts`)
- **State Management**: Zustand
- **Forms**: React Hook Form + Zod validation
- **Icons**: Lucide React
- **Testing**: Jest + React Testing Library (no tests exist yet)
- **CI/CD**: GitHub Actions → Coolify deployment
- **Node**: >=20.0.0

## Directory Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/             # Auth route group (login, register)
│   ├── api/                # API routes (REST endpoints)
│   │   ├── auth/           # login, logout, register, me
│   │   ├── chores/         # CRUD + complete/verify
│   │   ├── events/         # Calendar events
│   │   ├── family/         # Family management, join, lookup, members
│   │   ├── lists/          # Shared lists + items CRUD
│   │   ├── messages/       # Family messaging
│   │   ├── notifications/  # User notifications
│   │   ├── rewards/        # Rewards system
│   │   ├── analytics/      # Family analytics
│   │   ├── users/          # User management
│   │   └── health/         # Health check endpoint
│   ├── dashboard/          # Protected dashboard pages
│   │   ├── analytics/
│   │   ├── calendar/       # + create subpage
│   │   ├── chores/         # + create subpage
│   │   ├── family/         # + create, invite, settings
│   │   ├── lists/          # + create, [listId], type/[type]
│   │   ├── messages/
│   │   ├── rewards/        # + create subpage
│   │   └── settings/
│   ├── join/               # Family join page
│   ├── layout.tsx          # Root layout (Inter font, gradient bg)
│   ├── page.tsx            # Landing page
│   └── globals.css
├── components/             # React components by feature
│   ├── admin/              # AdminControls
│   ├── analytics/          # ProgressVisualization
│   ├── chores/             # ChoreList
│   ├── layout/             # DashboardNav
│   ├── lists/              # ListItems
│   ├── notifications/      # NotificationBell
│   └── rewards/            # RewardList
├── lib/                    # Shared utilities
│   ├── auth.ts             # JWT sign/verify, bcrypt hash/compare
│   ├── constants.ts        # App constants, enums, feature flags
│   ├── eventReminders.ts   # Event reminder logic
│   ├── notifications.ts    # Notification helpers
│   ├── notifications-server.ts
│   ├── prisma.ts           # Prisma client singleton
│   ├── supabase/server.ts  # Legacy stub — uses JWT, NOT Supabase
│   └── utils.ts            # cn(), formatDate, formatTime, etc.
├── middleware.ts            # Auth middleware (JWT cookie check)
└── types/
    └── index.ts            # TypeScript interfaces for all domain models
prisma/
└── schema.prisma           # Database schema
database/
├── setup.sql               # Initial DB setup
├── updates.sql             # Schema migrations
└── phase2-updates.sql      # Phase 2 schema updates
```

## Key Patterns

### Authentication
- JWT-based auth stored in `session_token` cookie
- `src/lib/auth.ts` — `signToken()`, `verifyToken()`, `hashPassword()`, `verifyPassword()`
- `src/lib/supabase/server.ts` — `getServerUser()` reads JWT from cookies (legacy name, NOT Supabase)
- `src/middleware.ts` — protects `/dashboard/*` routes, redirects auth routes if logged in
- API routes extract user from JWT via `getServerUser()`

### Database
- Prisma client singleton in `src/lib/prisma.ts` (global cache for dev hot-reload)
- Access via `prisma!.model.method()` — the `!` is needed because `prisma` can be `undefined` if `DATABASE_URL` is missing
- Schema uses `cuid()` for IDs, `snake_case` field names
- Models: User, Family, Chore, Event, Message, Reward, Notification

### User Roles
- Three roles: `parent`, `child`, `teen` (defined in `src/lib/constants.ts`)
- Parents have admin privileges (chore verification, family settings)

### API Routes
- All under `src/app/api/` using Next.js route handlers
- Pattern: export `GET`, `POST`, `PUT`, `DELETE`, `PATCH` functions from `route.ts`
- Auth check: call `getServerUser()`, return 401 if null
- Family scoping: most queries filter by user's `family_id`

### Styling
- Use `cn()` from `src/lib/utils.ts` for conditional Tailwind classes
- Color scheme: blue/indigo gradients, standard Tailwind palette
- Responsive design with `sm:`, `md:`, `lg:` breakpoints

### Feature Flags
- Phased rollout defined in `src/lib/constants.ts` (`FEATURE_FLAGS`)
- Phase 1 (active): Chore management, basic calendar, messaging, family setup
- Phase 2-4: Rewards, recurring chores, lists, mobile apps, analytics, subscriptions

## Development Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint
npm run type-check   # TypeScript type checking (tsc --noEmit)
npm run test         # Jest (no tests yet — runs with --passWithNoTests)
npm run format       # Prettier
npm run validate     # Type-check + Prisma validate
npx prisma generate  # Generate Prisma client (required before build)
npx prisma db push   # Push schema to database
```

## Environment Variables

Required (see `.env.example`):
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Secret for JWT signing (defaults to dev fallback)
- `NEXT_PUBLIC_APP_URL` — App URL (default `http://localhost:3000`)

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/deploy.yml`):
1. Checkout → Setup Node 20 → `npm ci --legacy-peer-deps`
2. `npx prisma generate` (with placeholder DATABASE_URL)
3. `npm run build` (with `SKIP_ENV_VALIDATION=true`)
4. `npm test -- --passWithNoTests --ci`
5. Trigger Coolify deployment via API

## Important Notes

- **Legacy Supabase references**: The app was migrated from Supabase to self-hosted Postgres + JWT. `src/lib/supabase/server.ts` still exists but only wraps JWT auth — do NOT import or use actual Supabase libraries
- **Prisma nullable**: The global `prisma` instance can be `undefined` if `DATABASE_URL` is not set — always use `prisma!` or check for null
- **Install flag**: Use `npm ci --legacy-peer-deps` due to peer dependency conflicts
- **Path alias**: `@/*` maps to `./src/*`
- **Docker**: Multi-stage build with standalone output, runs as non-root `nextjs` user
