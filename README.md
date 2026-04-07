# Family Planner App

**A comprehensive family management web application for chore tracking, calendar coordination, family communication, and responsibility building.**

A modern, full-featured family management platform designed to help households coordinate chores, track schedules, communicate effectively, and build responsibility through gamification.

## Features

### Core Modules

#### Family Management
- **Household Creation:** Create and manage family groups
- **Member Invites:** Invite family members via email or link
- **Role-Based Permissions:** Assign roles (Parent, Child, Admin)
- **Profile Management:** Customizable user profiles with avatars

#### Chore Tracking
- **Create & Assign Chores:** Add chores with descriptions, due dates, and assignees
- **Points System:** Reward completion with points
- **Recurring Tasks:** Set up daily, weekly, or monthly recurring chores
- **Completion Tracking:** Track completion history and patterns

#### Shared Calendar
- **Family Events:** Synchronized calendar for all family members
- **Event Details:** Dates, times, locations, and reminders
- **Color Coding:** Visual organization by event type
- **Calendar Sync:** Export to Google, Apple, or Outlook

#### Real-time Messaging
- **Family Chat:** Instant messaging between family members
- **Push Notifications:** Get notified of new messages
- **Message History:** Searchable conversation archive

#### Additional Features
- **Smart Notifications:** Automated reminders for chores and events
- **Shared Lists:** Shopping lists, to-do lists, and custom lists
- **Rewards System:** Points-based rewards to motivate family members
- **Analytics:** Family progress visualization and habit tracking

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 14 (App Router, standalone output) |
| Language | TypeScript (strict mode) |
| Database | PostgreSQL via Prisma 7 ORM |
| Authentication | Self-hosted JWT (bcryptjs + jsonwebtoken) |
| Styling | Tailwind CSS 3.4 (mobile-first responsive) |
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
# Clone the repository
git clone https://github.com/camster91/family-planner.git
cd family-planner

# Install dependencies
npm ci --legacy-peer-deps

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL and JWT_SECRET

# Generate Prisma client and push schema
npx prisma generate
npx prisma db push

# Run the development server
npm run dev
```

Visit `http://localhost:3000` to view the application.

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | Secret key for JWT signing | Yes |
| `NEXT_PUBLIC_APP_URL` | App URL (default `http://localhost:3000`) | No |

## Usage

### Development

```bash
npm run dev
```

### Production Build

```bash
npm run build
npm run start
```

### Database Commands

```bash
# Generate Prisma client
npx prisma generate

# Push schema changes
npx prisma db push

# Run migrations
npx prisma migrate dev

# Open Prisma Studio
npx prisma studio
```

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/            # Authentication pages
│   ├── (dashboard)/       # Main dashboard
│   ├── api/               # API routes
│   └── layout.tsx        # Root layout
├── components/            # React components
│   ├── ui/               # Base UI components
│   ├── chores/           # Chore tracking components
│   ├── calendar/         # Calendar components
│   └── chat/             # Messaging components
├── lib/                   # Utility functions
│   ├── auth.ts           # Authentication utilities
│   ├── db.ts             # Database utilities
│   └── notifications.ts  # Notification helpers
├── hooks/                 # Custom React hooks
└── types/                 # TypeScript types

prisma/
└── schema.prisma          # Database schema

database/
└── migrations/            # SQL migrations
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login user |
| GET | `/api/family` | Get family details |
| POST | `/api/family/invite` | Invite family member |
| GET | `/api/chores` | List family chores |
| POST | `/api/chores` | Create new chore |
| PUT | `/api/chores/:id/complete` | Mark chore complete |
| GET | `/api/events` | List calendar events |
| POST | `/api/events` | Create event |
| GET | `/api/messages` | Get chat messages |
| POST | `/api/messages` | Send message |

## Deployment

### Docker

```bash
# Build image
docker build -t family-planner .

# Run container
docker run -p 3000:3000 family-planner
```

### Docker Compose

```bash
docker-compose up -d
```

### Coolify

See `DEPLOYMENT.md` for detailed Coolify deployment instructions.

## Testing

```bash
# Run tests
npm run test

# Run tests in watch mode
npm run test:watch
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Jest tests |
| `npm run type-check` | TypeScript type checking |

## Roadmap

- [ ] Transition standalone features into modular GlowOS Agent Skills
- [ ] Connect the family calendar to the Pi Coding Agent for automated scheduling
- [ ] Migrate the real-time notification engine to the central GlowOS Broker
- [ ] Mobile app via Capacitor or React Native

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push and open a Pull Request

## License

MIT License

---
Built by Cameron Ashley / Nexus AI.
