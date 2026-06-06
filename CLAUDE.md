# CLAUDE.md - Family Planner App

## Project Overview

Family Planner is a full-stack web app for family organization: chore tracking with points/rewards, shared calendar, family messaging, shared lists, meal planning, notes, birthdays/anniversaries, rewards, budget, projects, analytics, emergency contacts, sick day tracking, babysitter handoff, wishlist, travel mode, locations, pickups, and allowance. Built with Next.js 14 (App Router), TypeScript, Prisma 7, and PostgreSQL. Deployed via Docker to Coolify.

**Live:** https://family.ashbi.ca

## Tech Stack

- **Framework**: Next.js 14 (App Router, `output: 'standalone'`)
- **Language**: TypeScript (strict mode)
- **Database**: PostgreSQL via Prisma 7 ORM
- **Auth**: Self-hosted JWT (bcryptjs + jsonwebtoken) — migrated from Supabase. `src/lib/supabase/server.ts` is a legacy stub (uses JWT, NOT Supabase)
- **Styling**: Tailwind CSS 3.4 with `clsx` + `tailwind-merge` (`cn()` helper in `src/lib/utils.ts`)
- **State Management**: Zustand
- **Forms**: React Hook Form + Zod validation
- **Icons**: Lucide React
- **CI/CD**: GitHub Actions → Coolify deployment
- **Node**: >=20.0.0

## Database — 26 Models

All models in `prisma/schema.prisma`. `Family.features` is a JSON column holding per-family feature flags.

```
User, Family, Chore, Event, Message, Notification, List, ListItem,
Activity, Reward, Transaction, BudgetCategory, Project, ProjectTask,
RateLimitEntry, FamilyMeal, PinnedNote, Anniversary, FamilyLocation,
Pickup, Allowance, EmergencyContact, SickDay, Medication, Handoff, WishlistItem
```

## User Roles

Three roles: `parent`, `child`, `teen` (defined in `src/lib/constants.ts`).

- **parent**: full access — chore verification, family settings, member management, feature toggles
- **child**: kid mode — sees `KidHome` (Today's Missions + XP/level card + reward claims)
- **teen**: currently cosmetic — same `KidHome` UI as `child`. Teen is a distinct role in the schema but renders identically to child. This is a known gap (per Sam persona in the gauntlet plan).

## Key Patterns

### Authentication
- JWT-based auth stored in `session_token` cookie
- `src/lib/auth.ts` — `signToken()`, `verifyToken()`, `hashPassword()`, `verifyPassword()`
- `src/lib/supabase/server.ts` — `getServerUser()` reads JWT from cookies (legacy name, NOT Supabase). Returns narrow type `{ id, email }` — cast to `SessionUser` at call site
- `src/middleware.ts` — protects `/dashboard/*` routes, redirects auth routes if logged in

### API Auth Helpers (from `@/lib/api-auth`)
- `authenticateRequest(request)` — validates JWT, returns user or 401
- `authenticateWithFamily(request)` — validates JWT + family_id presence
- `requireParent(request)` — validates parent role, returns 403 if not parent

### Database
- Prisma client singleton in `src/lib/prisma.ts` (global cache for dev hot-reload)
- Access via `prisma!.model.method()` — the `!` is needed because `prisma` can be `undefined` if `DATABASE_URL` is missing
- Schema uses `cuid()` for IDs, `snake_case` field names

### Route Handler Patterns (Next.js 15)

**`params` must be awaited** — Next.js 15 route handlers receive `params` as a `Promise`:

```ts
// Old (Next 14) — build-fails
export async function PATCH(request: Request, { params }: { params: { id: string } }) { ... }

// New (Next.js 15) — required
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  ...
}
```

**`getServerUser()` returns narrow type** — The helper returns `{ id, email }` only. The JWT also contains `role` and `family_id`. Always cast at the call site:

```ts
type SessionUser = { id: string; email: string; role?: string; family_id?: string | null }
const user = (await getServerUser()) as SessionUser | null
if (user?.role !== 'parent') return NextResponse.json({ error: 'Parents only' }, { status: 403 })
```

**CSRF protection** — All `/api/*` mutation routes are protected by CSRF validation (`validateCsrf()`) except:
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/logout`

(Per documented threat model — auth endpoints are CSRF-exempt.)

### Feature Flags

Per-family opt-in/opt-out stored in `Family.features` JSON column. Source of truth: `src/lib/features.ts`.

| Group | Features | Default |
|-------|----------|---------|
| **core** (cannot disable) | Chores, Calendar, Lists, Family | always on |
| **planning** (on by default) | Meals, Notes, Anniversaries, Rewards, Budget, Projects, Messages, Analytics | on |
| **family** (off by default) | Locations, Pickups, Allowance, Sick days, Handoff, Travel | off |
| **core-adj** | Emergency contacts | on |

5 new features shipped (2026-06-06):
- **Emergency contacts** — `emergency_contacts` — core-adj, default on
- **Sick days & meds** — `sick_days` — family, default off
- **Babysitter handoff** — `handoff` — family, default off
- **Wishlist** — `wishlist` — planning, default off
- **Travel mode** — `travel` — family, default off

Key files:
- `src/lib/features.ts` — `FeatureKey`, `FEATURES`, `normalizeFeatures`, `defaultFeatures`
- `src/components/providers/features-provider.tsx` — React context, `useFeatures`, `useFeatureEnabled`
- `src/components/ui/feature-gate.tsx` — `<FeatureGate featureKey="...">` wrapper
- `src/app/api/family/features/route.ts` — GET (anyone in family) + PATCH (parent only)

### i18n

- File: `src/i18n/index.tsx`
- Languages: English (en) + Spanish (es) — inline messages, no separate JSON files
- Hook: `useTranslation()` — call `t('key.here')` for all user-facing strings
- Rule: add key to BOTH `en` and `es` sections before using; missing key renders as raw string

### Design System — 12 Primitives

All in `src/components/ui/`:

| Primitive | Purpose |
|-----------|---------|
| `Glyph` | Colorful rounded square icon (sizes: sm/md/lg; colors map to tint tokens) |
| `Avatar` | Colored-circle monogram, deterministic color from name hash (sizes: xs–xl) |
| `ProgressRing` | Apple Activity-style ring, 12 o'clock start, spring-animated |
| `EmptyState` | Glyph + headline + sub + CTA for zero-data states |
| `ListRow` | Settings-style row with icon, title, subtitle, trailing, chevron |
| `InsetList` | iOS grouped table background (card wrapper) |
| `SectionHeader` | iOS uppercase section label |
| `LargeHeader` | "Good morning, Cam" Apple-style page header |
| `CheckboxRow` | iOS Reminders-style full-row checkbox with bounce-pop |
| `SearchField` | Rounded-full soft-fill search input |
| `TabBar` | iOS bottom tab bar, mobile-only (`.md:hidden`), 4 destinations |
| `FeatureGate` | Shows "turn on" state when feature is disabled |

Plus 2 interaction primitives:
- `SwipeRow` — swipe-left complete, swipe-right delete (100px threshold)
- `LongPressRow` — 500ms hold triggers iOS action sheet

**Surface tokens** (in `src/app/globals.css`): `--surface-base`, `--surface-elevated`, `--surface-grouped`, `--surface-grouped-secondary`, `--surface-fill`, `--surface-fill-secondary`, `--surface-separator`

**Button classes**: `.btn-filled`, `.btn-tinted`, `.btn-plain`, `.btn-ghost`, `.btn-destructive` — written as raw CSS in `globals.css`, NOT `@apply` (PostCSS limitation with CSS variables inside `@apply`)

### Recurring Chores

- File: `src/lib/recurringChores.ts`
- `expandRecurringChores(chore, familyId)` generates next N occurrences (daily=7, weekly=4, monthly=3) as pending chores
- Uses `chore.due_date` as base for expansion, NOT `Date.now()`
- Filters out `status === 'overdue'` from expansion results
- No cron in production — triggered by user action (POST to `/api/cron/recurring-chores` exists but is dormant)
- Pattern: expand lazily from `POST /api/chores/complete` when a kid marks a recurring chore done

**No cron rule:** Cam explicitly rejects all scheduled jobs. The recurring-chores endpoint must not be wired to any scheduler. Trigger from user-visible actions only.

## Directory Structure

```
src/
├── app/
│   ├── (auth)/             # login, register
│   ├── api/                # REST endpoints
│   │   ├── auth/           # login, logout, register, me
│   │   ├── chores/         # CRUD + complete/verify
│   │   ├── events/         # Calendar events
│   │   ├── family/         # Family management, join, lookup, members, features
│   │   ├── lists/          # Shared lists + items CRUD
│   │   ├── messages/       # Family messaging
│   │   ├── rewards/        # Rewards system
│   │   ├── analytics/      # Family analytics
│   │   ├── budget/         # Transactions + categories
│   │   ├── projects/       # Projects + tasks
│   │   ├── locations/      # Family locations
│   │   ├── pickups/       # Pickup coordination
│   │   ├── allowance/      # Allowance tracking
│   │   ├── emergency-contacts/  # NEW
│   │   ├── sick-days/      # NEW
│   │   ├── medications/    # NEW
│   │   ├── handoff/        # NEW
│   │   ├── wishlist/       # NEW
│   │   ├── family/travel/  # NEW
│   │   ├── cron/           # recurring-chores (dormant)
│   │   ├── upload/         # Photo upload
│   │   └── health/
│   └── dashboard/          # Protected pages (FeatureGate on planning/family pages)
├── components/
│   ├── ui/                 # 12 design primitives
│   ├── dashboard/          # DashboardHome, KidHome, ChoreList, etc.
│   ├── layout/             # DashboardNav, CommandPalette
│   └── providers/          # features-provider, i18n-provider
├── lib/
│   ├── features.ts         # FeatureKey, FEATURES, normalizeFeatures
│   ├── auth.ts             # JWT sign/verify, bcrypt
│   ├── api-auth.ts         # authenticateRequest, authenticateWithFamily, requireParent
│   ├── supabase/server.ts  # Legacy stub — NOT Supabase
│   ├── recurringChores.ts  # expandRecurringChores
│   ├── nav-items.ts        # Nav array (used by Nav + CommandPalette)
│   └── utils.ts            # cn()
├── i18n/
│   └── index.tsx           # en + es inline messages, useTranslation()
└── middleware.ts           # JWT cookie check on /dashboard/*
prisma/
└── schema.prisma           # 26 models
.github/
└── workflows/              # 7 workflows: ci, build-push, deploy-from-ghcr, deploy, apk, stale-issues, auto-merge
```

## Development Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint
npm run type-check   # TypeScript type checking (tsc --noEmit)
npm run format       # Prettier
npm run validate     # Type-check + Prisma validate
npx prisma generate  # Generate Prisma client (required after schema changes)
npx prisma db push   # Push schema to database
npx prisma studio    # Browse data
```

## Environment Variables

Required (see `.env.example`):
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Secret for JWT signing (defaults to dev fallback)
- `NEXT_PUBLIC_APP_URL` — App URL (default `http://localhost:3000`)
- `NEXT_PUBLIC_APP_NAME` — App display name (e.g., "Family Planner")

## CI/CD Pipeline — 7 GitHub Actions Workflows

| Workflow | Purpose |
|----------|---------|
| `ci.yml` | lint + type-check + test + docker build |
| `build-push.yml` | Build image and push to `ghcr.io` |
| `deploy-from-ghcr.yml` | Deploy from ghcr.io image to Coolify |
| `deploy.yml` | Coolify source-build (git source, Coolify builds) |
| `apk.yml` | Capacitor Android build |
| `stale-issues.yml` | Auto-close stale issues |
| `auto-merge.yml` | Auto-merge dependabot PRs |

Canonical production deploy: `deploy.yml` (Coolify source build). `build-push.yml` + `deploy-from-ghcr.yml` used for image-based deploys.

## Important Notes

- **Legacy Supabase references**: `src/lib/supabase/server.ts` is a legacy stub — it wraps JWT auth only. Do NOT import actual Supabase libraries.
- **Prisma nullable**: `prisma` can be `undefined` if `DATABASE_URL` is missing — always use `prisma!` or null-check.
- **Install flag**: `npm ci --legacy-peer-deps` due to peer dependency conflicts.
- **Path alias**: `@/*` maps to `./src/*`
- **No cron**: Recurring chores expand lazily from user actions. Do not add Coolify scheduled tasks or external cron.
- **Subagent re-verification**: After parallel-agent batches, always re-run `tsc --noEmit` and `npm run build` directly — agents have fabricated clean outputs in past sessions.