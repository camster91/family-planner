# Family Planner

One calm home for the whole household: chores, calendar, meals, groceries and lists, shared between parents and kids, with a fridge-tablet mode for the kitchen.

![Family Planner: chores, calendar, meals and lists, together](public/og-image.jpg)

## What it does

Family Planner brings the everyday logistics of a busy household into one place. Parents plan the week, kids see only today's missions, and a wall-mounted tablet can show the day at a glance. A new household starts simple (chores, calendar, lists, family, meals and emergency info) and parents turn on more sections only when they need them.

## Features

**Everyday**
- **Today board:** today's events, dinner tonight, groceries to buy and each child's chores on one screen
- **Chores:** assign, schedule recurring chores, and let kids complete them with an optional photo for a parent to verify or reject
- **Picture routines** for young kids, and a kid view that shows only today's missions
- **Family calendar:** shared events, read-only ICS import, and optional two-way Google and Outlook sync
- **Meals, recipes and groceries:** plan dinners, send recipe ingredients to the grocery list (with undo), and sort groceries by store section
- **Food inventory** with expiry dates, "use soon" and "what can I cook"
- **Shared lists**, notes and messaging between family members

**Fridge and tablet**
- **Fridge mode:** a 16:10 hub with member colours, opt-in weather and a calm night display
- **Shared household device:** pair a kitchen tablet with its own scoped session, separate from personal accounts

**Optional sections** (off until a parent turns them on)
- Points, streaks, leaderboard and a rewards catalog
- Budget, projects, birthdays and anniversaries, wishlist
- Locations, pickups, allowance, travel mode
- Sick days and medication log, babysitter handoff with a printable sitter brief
- Emergency contacts with a printable fridge card (always on)

**Also**
- Parent, child and teen roles with household isolation on every API route
- English and Spanish
- "Download my data" export, per-member quiet hours, and Undo instead of confirm dialogs
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
npm ci
cp .env.example .env         # set POSTGRES_PASSWORD, DATABASE_URL and JWT_SECRET
docker compose up -d postgres
npm run dev                  # http://localhost:3000
```

The full walkthrough, including schema setup and fixture households, is in [SETUP.md](SETUP.md). Optional integrations (email, calendar sync, AI capture, analytics, weather) stay off until their variables in `.env.example` are set.

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

Every pull request runs the `Build & Test` job in `.github/workflows/release.yml`, plus Playwright end-to-end tests across phone, tablet, desktop and fridge viewports.

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

## License

[MIT](LICENSE)
