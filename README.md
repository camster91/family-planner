# Family Planner App

**A comprehensive family management web application for chore tracking, calendar coordination, family communication, and responsibility building.**

As part of the broader **Nexus AI & GlowOS Future Planning**, the Family Planner app serves as a robust foundation for modern household management. Moving forward, capabilities from this repository will be evaluated for consolidation into a singular, unified Agent OS experience, allowing personal AI assistants to seamlessly interact with family calendars and task lists.

## Features (Phase 1 MVP Complete)

### Core Modules
- **Family Management:** Create households, invite members, and assign role-based permissions.
- **Chore Tracking:** Create, assign, track, and complete chores with a built-in points system.
- **Shared Calendar:** Synchronized family events complete with dates, times, and locations.
- **Real-time Messaging:** Dedicated family chat with instant notifications.
- **Smart Notifications:** Automated reminders for chores, events, and new messages.
- **Shared Lists:** Shopping lists, to-do lists, and custom lists for the whole family.
- **Rewards System:** Points-based rewards to motivate family members.
- **Analytics:** Family progress visualization and habit tracking.

### Technical Architecture
- **Framework:** Next.js 14 (App Router, standalone output)
- **Language:** TypeScript (strict mode)
- **Database:** PostgreSQL via Prisma 7 ORM
- **Auth:** Self-hosted JWT (bcryptjs + jsonwebtoken)
- **Styling:** Tailwind CSS 3.4, mobile-first responsive design
- **State Management:** Zustand
- **Forms:** React Hook Form + Zod validation
- **Deployment:** Docker + Coolify

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL database
- Git

### Quick Installation

```bash
# Clone the repository
git clone https://github.com/camster91/family-planner.git
cd family-planner

# Install dependencies
npm ci --legacy-peer-deps

# Set up your environment variables
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL and JWT_SECRET

# Generate Prisma client and push schema
npx prisma generate
npx prisma db push

# Run the development server
npm run dev
```

Visit `http://localhost:3000` to view the application.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | Secret key for JWT signing | Yes |
| `NEXT_PUBLIC_APP_URL` | App URL (default `http://localhost:3000`) | No |

## Roadmap & Consolidation Strategy

- [ ] Transition standalone features into modular GlowOS Agent Skills.
- [ ] Connect the family calendar to the Pi Coding Agent for automated household scheduling.
- [ ] Migrate the real-time notification engine to the central GlowOS Broker.

---
*Built by Cameron Ashley / Nexus AI.*
