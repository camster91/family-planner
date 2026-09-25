# Family Planner App

**A complete family organizer:** chores + calendar + lists + family management + meal planning + notes + birthdays + rewards + budget + projects + messages + analytics + emergency contacts + sick day tracking + babysitter handoff + wishlist + travel mode + locations + pickups + allowance.

**Live:** https://family.ashbi.ca

**Contributors and agents start here:** [`AGENTS.md`](AGENTS.md) and [`docs/START_HERE.md`](docs/START_HERE.md) (documentation authority). Release/security gates: [`docs/PRODUCT_PROGRAM.md`](docs/PRODUCT_PROGRAM.md).

20 features, all gated by per-family opt-in flags. Built for parents managing households with kids of all ages.

## Features

### Core (always on)

- **Chore Tracking** — create, assign, complete, verify with photo. Recurring chores (daily/weekly/monthly). XP points + streak tracking.
- **Family Calendar** — events with dates, times, locations. Shared across all family members.
- **Shared Lists** — shopping, to-do, meal plan, wishlist. Real-time sync.
- **Family Management** — create/join family, invite members, role-based access.

### Planning (opt-in, on by default)

- **Meal Planning** — weekly meal calendar with breakfast/lunch/dinner slots.
- **Notes** — pinned family notes, color-coded.
- **Birthdays & Anniversaries** — track important dates with countdown.
- **Rewards** — XP-based reward catalog, one-tap claim for kids.
- **Budget** — transaction tracking + budget categories.
- **Projects** — trip planning, home projects, task breakdowns.
- **Family Messaging** — real-time chat between family members.
- **Analytics** — weekly completion stats, leaderboard, streaks.

### Family Life (opt-in, off by default)

- **Locations** — save home, school, work with addresses.
- **Pickups** — coordinate who is picking up whom.
- **Allowance** — track IOUs and weekly allowance.
- **Sick Days & Meds** — active illness log + med schedule.
- **Babysitter Handoff** — one-screen sitter brief with print view.
- **Travel Mode** — mute notifications + shift schedule by timezone.

### Emergency (always on)

- **Emergency Contacts** — printable fridge card with contacts, allergies, medications.

## Tech Stack

Exact versions live in `package.json`; the schema lives in `prisma/schema.prisma`.

| Category       | Technology                                                  |
| -------------- | ----------------------------------------------------------- |
| Framework      | Next.js 16 (App Router, standalone output)                  |
| Language       | TypeScript (strict mode)                                    |
| Database       | PostgreSQL 17 via Prisma 7 (`@prisma/adapter-pg`)           |
| Authentication | Self-hosted JWT session cookie (bcryptjs + jsonwebtoken)    |
| Styling        | Tailwind CSS 3.4 with design tokens                         |
| State / forms  | Zustand, React Hook Form + Zod                              |
| Android        | Capacitor 8 shell (`android/`)                              |
| Deployment     | Docker image on the VPS, released by a manual GitHub Actions run |

## Quick Start

Requires Node.js 22 (`.nvmrc`; `package.json` engines: node >= 22, npm >= 10), Docker for the local PostgreSQL, and Git.

```bash
git clone https://github.com/camster91/family-planner.git
cd family-planner
nvm use                      # or any Node 22.18+ install
npm ci
cp .env.example .env         # set POSTGRES_PASSWORD, DATABASE_URL, JWT_SECRET
docker compose up -d postgres
```

The full walkthrough, including the host-side `DATABASE_URL`, schema setup and fixtures, is in [SETUP.md](SETUP.md).

### Environment variables

Templates: [`.env.example`](.env.example) (local) and [`.env.production.example`](.env.production.example) (production).

| Variable                                                  | Purpose                                                                                     | Required                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------- |
| `DATABASE_URL`                                            | PostgreSQL connection string                                                                | Yes                           |
| `JWT_SECRET`                                              | Session signing and at-rest secret encryption; at least 32 characters in production         | Yes                           |
| `POSTGRES_PASSWORD`                                       | Password for the `docker-compose.yml` database (must match `DATABASE_URL`)                  | For Docker Compose            |
| `NEXT_PUBLIC_APP_URL`                                     | Public app URL used in links and emails                                                     | Recommended                   |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`       | Invite, verification and reset email                                                        | `MAILGUN_API_KEY` for email   |
| `CRON_SECRET`                                             | Enables `POST /api/cron/recurring-chores`; empty keeps it disabled                          | No                            |
| `TRUSTED_PROXY_HOPS`                                      | Reverse proxies in front of the app, for client-IP rate limiting (default 1)                | No                            |
| `UPLOAD_DIR`                                              | Upload storage path (default `/data/family-planner-uploads`)                                | No                            |
| `CAPTURE_AI_KEY`, `CAPTURE_AI_BASE_URL`, `CAPTURE_AI_MODEL` | Server-level fallback for AI capture; families normally configure this in Settings        | No                            |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`     | Client analytics; disabled when unset                                                       | No                            |
| `MIGRATE_FALLBACK_DB`                                     | Maintenance database `scripts/migrate.js` uses when `postgres` is unavailable               | No                            |

## User Roles

| Role       | Access                                                                             |
| ---------- | ---------------------------------------------------------------------------------- |
| **Parent** | Full access — create/verify chores, manage family, toggle features, view analytics |
| **Child**  | Kid mode — see today's missions, complete chores, claim rewards                    |
| **Teen**   | Same kid mode as child (teen UI is cosmetic-only in current version)               |

## Development

```bash
npm run dev            # Dev server on http://localhost:3000
npm run build          # Production build (next build --webpack)
npm run start          # Serve the production build
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit (type-check is an alias)
npm run format:check   # Prettier on the file set CI checks
npm run validate       # typecheck + prisma validate
npx prisma studio      # Browse the database (needs DATABASE_URL in the shell)
```

`npm run format` runs `prettier --write .` over the whole repository; prefer formatting only the files you changed.

## Project Structure

```
src/
├── app/               # App Router pages and REST API routes (api/)
├── components/        # UI primitives, dashboard features, layout
├── lib/               # Auth, Prisma client, feature flags, domain logic, fixtures
├── i18n/              # Inline messages
└── middleware.ts      # Session cookie gate for /dashboard and auth routes

prisma/schema.prisma   # Canonical data model (Prisma client generation)
scripts/migrate.js     # Idempotent schema migration, run at container start
database/migration-*.sql  # Per-feature idempotent SQL applied by migrate.js
android/               # Capacitor Android project
.github/workflows/      # release.yml, apk.yml, auto-merge.yml, stale-issues.yml
```

## Testing

```bash
npx prisma generate      # required after a clean install
npm test                 # Jest unit and contract tests
npm run verify:app       # Full local gate: generate, typecheck, lint, test, build, audit
```

- Deterministic fixture households: `npm run fixtures:seed` / `npm run fixtures:reset` (guarded; see [docs/testing/TEST_DATA.md](docs/testing/TEST_DATA.md)).
- Browser end-to-end tests: [docs/testing/E2E.md](docs/testing/E2E.md).

CI runs the `Build & Test` job in `.github/workflows/release.yml` on every pull request; see [docs/engineering/CI_AND_RELEASE.md](docs/engineering/CI_AND_RELEASE.md).

## Deployment

`docker-compose.yml` is for local, self-contained runs only. Production is released by a manually dispatched `Release to VPS` job that promotes the exact smoke-tested image; the container runs `scripts/migrate.js` on start. See [DEPLOYMENT.md](DEPLOYMENT.md).

## License

MIT — Cameron Ashley
