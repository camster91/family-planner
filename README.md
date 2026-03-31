# Family Planner App

**A comprehensive family management web application for chore tracking, calendar coordination, family communication, and responsibility building.** 

As part of the broader **Nexus AI & GlowOS Future Planning**, the Family Planner app serves as a robust foundation for modern household management. Moving forward, capabilities from this repository will be evaluated for consolidation into a singular, unified Agent OS experience, allowing personal AI assistants to seamlessly interact with family calendars and task lists.

## 🚀 Features (Phase 1 MVP Complete)

### Core Modules
- **Family Management:** Create households, invite members, and assign role-based permissions.
- **Chore Tracking:** Create, assign, track, and complete chores with a built-in points system.
- **Shared Calendar:** Synchronized family events complete with dates, times, and locations.
- **Real-time Messaging:** Dedicated family chat with instant notifications.
- **Smart Notifications:** Automated reminders for chores, events, and new messages.

### Technical Architecture
- **Framework:** Next.js 14 (App Router)
- **Backend & Auth:** Supabase (Auth + Real-time Database)
- **Security:** Strict Row Level Security (RLS) policies.
- **Design:** Mobile-first, fully responsive Tailwind CSS.
- **Language:** End-to-end TypeScript for strict type safety.

## 🛠️ Getting Started

### Prerequisites
- Node.js 18+ 
- Supabase account (free tier)

### Quick Installation

```bash
# Clone the repository
git clone https://github.com/camster91/family-planner.git
cd family-planner

# Install dependencies
npm install

# Set up your environment variables
cp .env.example .env.local
# (Add your Supabase URL and Anon Key to .env.local)

# Run the development server
npm run dev
```

Visit `http://localhost:3000` to view the application.

## 📈 Roadmap & Consolidation Strategy

- [ ] Transition standalone features into modular GlowOS Agent Skills.
- [ ] Connect the family calendar to the Pi Coding Agent for automated household scheduling.
- [ ] Migrate the real-time notification engine to the central GlowOS Broker.

---
*Built by Cameron Ashley / Nexus AI.*
