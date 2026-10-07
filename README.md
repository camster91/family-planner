# Herewoven

One calm home for the whole household: chores, calendar, meals, groceries and lists, shared between parents and kids, with a fridge-tablet mode for the kitchen.

![Herewoven](public/brand/woven-grove/logos/herewoven-horizontal.png)

**Live:** https://family.ashbi.ca

**Contributors and agents:** start with [AGENTS.md](AGENTS.md) and [docs/START_HERE.md](docs/START_HERE.md). [CURRENT_STATE.md](docs/CURRENT_STATE.md) records implementation and external gates; the [launch checklist](docs/LAUNCH_CHECKLIST.md) tracks production acceptance. This repository is `camster91/family-planner`; legal and transactional-email naming remain owner decisions (#372).

## What it does

Herewoven brings the everyday logistics of a busy household into one place. Parents plan the week, kids see their own missions, and a wall-mounted tablet can show the day at a glance. A new household starts simple (chores, calendar, lists, family, meals and emergency info) and parents turn on more sections only when they need them.

## Features

**Everyday**
- **Today board:** today's events, dinner tonight, groceries to buy and each child's chores on one screen
- **Chores:** assign, schedule recurring chores, and let kids complete them with an optional photo for a parent to verify or reject
- **Picture routines** for young kids, and a kid view with today's missions and earlier chores
- **Family calendar:** shared events, read-only ICS import, and optional two-way Google and Outlook sync
- **Meals, recipes and groceries:** plan dinners, send recipe ingredients to the grocery list (with undo), and sort groceries by store section
- **Shared lists** for groceries, to-dos and packing

**Fridge and tablet**
- **Fridge mode:** a 16:10 hub with member colours, opt-in weather and a calm night display
- **Shared household device:** pair a kitchen tablet with its own scoped session, separate from personal accounts

**Optional sections** (off until a parent turns them on)
- Points, streaks, leaderboard and a rewards catalog
- Budget, projects, birthdays and anniversaries, wishlist
- Locations, pickups, allowance, travel mode
- Sick days and medication log, babysitter handoff with a printable sitter brief
- Food inventory with expiry dates, "use soon" and "what can I cook"
- Notes, messaging and analytics (analytics and rewards need Points & streaks)

Emergency contacts and their printable fridge card are on for new households. Existing households retain their previous settings; [src/lib/features.ts](src/lib/features.ts) defines defaults and dependencies. Features control availability; role restrictions still apply.

**Also**
- Parent, child and teen roles, plus separate scoped shared-device sessions; household isolation is a release gate
- English and Spanish, with regional date/time formatting follow-ups tracked in #374
- "Download my data" export, per-member quiet hours, and Undo for supported actions
- Optional AI-assisted capture: import events from text, a photo or a PDF, always reviewed before saving
- Android app shell built with Capacitor

## Tech stack

| Area | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 18 |
| Language | TypeScript (strict) |
| Database | PostgreSQL via Prisma 7 |
| Auth | Self-hosted JWT session cookies (bcryptjs, jsonwebtoken) |
| UI | Tailwind CSS with design tokens, lucide icons |
| State and forms | Zustand, React Hook Form, Zod |
| Calendar | ical.js |
| Mobile | Capacitor 8 (Android) |
| Testing | Jest, Testing Library, Playwright with axe-core |
| Delivery | Docker, GitHub Actions |

## Getting started

Requires Node.js 22 (see `.nvmrc`) and Docker for the local database.

```bash
git clone https://github.com/camster91/family-planner.git
cd family-planner
nvm use                      # or install a supported Node version
npm ci
cp .env.example .env         # set POSTGRES_PASSWORD, DATABASE_URL and JWT_SECRET
docker compose up -d postgres
```

The full walkthrough, including schema setup and fixture households, is in [SETUP.md](SETUP.md). Complete that walkthrough before running `npm run dev`. Mailgun is the current email implementation; provider/sender approval and real verification/reset delivery remain gates (#103). Calendar OAuth, AI capture, analytics and weather have separate configuration and consent requirements. See [transactional email](docs/runbooks/TRANSACTIONAL_EMAIL.md) and [calendar sync](docs/runbooks/CALENDAR_SYNC.md); configuration alone is not production acceptance.

All seven Hermes cron jobs remain paused. Do not enable notification schedules or replacement jobs without explicit owner approval.

## Scripts

```bash
npm run dev            # dev server
npm run build          # production build
npm run start          # serve the production build
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run validate       # typecheck + prisma validate
npm run fixtures:seed  # deterministic test households (guarded)
```

## Testing

```bash
npx prisma generate    # once after a clean install
npm test               # Jest unit and contract tests
npm run test:e2e       # Playwright end-to-end, accessibility and visual tests
npm run verify:app     # generate, typecheck, lint, test, build and dependency audit
```

Pull-request CI includes `Build & Test` and Playwright end-to-end tests across phone, tablet, desktop and fridge viewports. Use [CI_AND_RELEASE.md](docs/engineering/CI_AND_RELEASE.md) for the actual gates and [E2E.md](docs/testing/E2E.md) for database/browser setup. Android additionally needs the commands and hardware evidence in [ANDROID.md](docs/architecture/ANDROID.md). A green web build does not prove live email, recovery, device behavior or family isolation.

## Project structure

```
src/
  app/               App Router pages and REST API routes
  components/        UI primitives, dashboard features, layout
  lib/               Auth, Prisma client, feature flags, domain logic, fixtures
  i18n/              Messages (English, Spanish)
  middleware.ts      Session gate for the dashboard
prisma/              Data model
database/            Idempotent per-feature SQL migrations
scripts/             Migration runner, fixtures and tooling
e2e/                 Playwright specs and visual baselines
android/             Capacitor Android project
docs/                Product, architecture and engineering docs
```

## Deployment

The current release path is protected `main` followed by the existing Coolify source build. Coolify rebuilds the merged revision; this is not promotion of an immutable CI image. Retained manual SSH/image-promotion instructions describe a historical route and must not be triggered as a second deployment. Confirm the exact merged revision at `/api/version`, healthy `/api/health`, approved assets and applicable safe journeys before claiming production success. Keep the prior healthy revision and rollback evidence. Changes to deployment policy or infrastructure require owner approval.

See [Coolify operations](docs/runbooks/COOLIFY_DEPLOY.md). `docker-compose.yml` is for local, self-contained runs.

## License

[MIT](LICENSE)
