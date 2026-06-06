# Family Planner App

**A complete family organizer:** chores + calendar + lists + family management + meal planning + notes + birthdays + rewards + budget + projects + messages + analytics + emergency contacts + sick day tracking + babysitter handoff + wishlist + travel mode + locations + pickups + allowance.

**Live:** https://family.ashbi.ca

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

| Category | Technology |
|----------|------------|
| Framework | Next.js 14 (App Router, standalone output) |
| Language | TypeScript (strict mode) |
| Database | PostgreSQL via Prisma 7 ORM |
| Authentication | Self-hosted JWT (bcryptjs + jsonwebtoken) |
| Styling | Tailwind CSS 3.4 (Apple HIG design system) |
| State | Zustand |
| Forms | React Hook Form + Zod validation |
| Deployment | Docker + Coolify |

## Prerequisites

- Node.js 20+
- PostgreSQL database
- Git

## Installation

### Quick Start

```bash
git clone https://github.com/camster91/family-planner.git
cd family-planner
npm ci --legacy-peer-deps
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL and JWT_SECRET
npx prisma generate
npx prisma db push
npm run dev
```

Visit `http://localhost:3000`.

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | Secret key for JWT signing | Yes |
| `NEXT_PUBLIC_APP_URL` | App URL (default `http://localhost:3000`) | No |
| `NEXT_PUBLIC_APP_NAME` | App display name (default "Family Planner") | No |

## User Roles

| Role | Access |
|------|--------|
| **Parent** | Full access — create/verify chores, manage family, toggle features, view analytics |
| **Child** | Kid mode — see today's missions, complete chores, claim rewards |
| **Teen** | Same kid mode as child (teen UI is cosmetic-only in current version) |

## Development

```bash
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Production build
npm run start        # Start production server
npm run lint          # ESLint
npm run type-check   # TypeScript (tsc --noEmit)
npm run format       # Prettier
npx prisma studio    # Browse database
```

## Project Structure

```
src/
├── app/
│   ├── (auth)/            # Login, register
│   ├── api/               # REST API routes
│   ├── dashboard/         # Protected pages (FeatureGate on opt-in features)
│   └── page.tsx           # Landing page
├── components/
│   ├── ui/               # 12 design primitives (Glyph, Avatar, ListRow, etc.)
│   ├── dashboard/        # Feature components
│   └── layout/           # Nav, CommandPalette, TabBar
├── lib/
│   ├── features.ts        # Feature flags (FEATURES, FeatureKey)
│   ├── auth.ts            # JWT utilities
│   ├── api-auth.ts        # Auth helpers (authenticateRequest, requireParent)
│   ├── recurringChores.ts # Recurring chore expansion
│   └── utils.ts           # cn() helper
└── i18n/
    └── index.tsx          # en + es inline messages

prisma/
└── schema.prisma          # 26 models

.github/
└── workflows/             # 7 CI/CD workflows
```

## Deployment

### Docker

```bash
docker build -t family-planner .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e JWT_SECRET="your-secret" \
  family-planner
```

### Coolify

See `DEPLOYMENT.md` for detailed Coolify deployment instructions.

### CI/CD

7 GitHub Actions workflows handle lint/type/test/build/image-push/deploy/APK.

## Testing

```bash
npm run type-check   # Must pass before PR
npm run build        # Must succeed before deploy
```

## License

MIT — Cameron Ashley