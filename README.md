# Family Planner App

## 🚀 Phase 1 MVP Complete - Ready for Development

A comprehensive family management web app for chore tracking, calendar coordination, family communication, and responsibility building. Built with Next.js 14, Supabase, and TypeScript.

### ✨ Features Implemented (Phase 1)

#### ✅ **Core Features**
- **Family Management**: Create families, invite members, role-based permissions
- **Chore Tracking**: Create, assign, track, and complete chores with points system
- **Shared Calendar**: Family events with dates, times, and locations
- **Real-time Messaging**: Family chat with instant notifications
- **Notifications**: Smart reminders for chores, events, and messages
- **User Profiles**: Customizable profiles with preferences

#### ✅ **Technical Features**
- **Authentication**: Secure login/register with Supabase Auth
- **Real-time Updates**: Live messaging and notifications
- **Database Security**: Row Level Security (RLS) policies
- **Responsive Design**: Mobile-first, works on all devices
- **Type Safety**: Full TypeScript implementation

## 🛠️ Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Git
- Supabase account (free tier)

### Quick Installation
```bash
# Clone and setup
git clone <repository-url>
cd family-planner-app

# Run setup script
# Windows: setup.bat
# Mac/Linux: chmod +x setup.sh && ./setup.sh

# Or manually:
npm install
cp .env.example .env.local
# Edit .env.local with your Supabase credentials
```

### Database Setup
1. Create a Supabase project at https://supabase.com
2. Run `database/setup.sql` in the SQL Editor
3. (Optional) Run `database/updates.sql` for additional features
4. Copy your project URL and anon key to `.env.local`

### Development
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

### Building for Production
```bash
npm run build
npm start
```

### Testing with Sample Data
Uncomment the sample data section in `database/setup.sql` to create test families and users.

## Project Structure

```
family-planner-app/
├── src/app/                 # Next.js App Router
│   ├── (auth)/              # Auth pages (login, register)
│   ├── join/                # Join family with code
│   ├── dashboard/           # Protected app pages
│   │   ├── chores/          # Chore management (list, create)
│   │   ├── calendar/        # Calendar (list, create events)
│   │   ├── messages/        # Family messaging
│   │   ├── family/          # Family management (members, invite, settings)
│   │   ├── settings/        # User settings
│   │   └── layout.tsx       # Dashboard layout
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Landing page
├── src/components/          # React components
│   ├── layout/              # Layout components (DashboardNav)
│   ├── chores/              # Chore components (ChoreList)
│   ├── notifications/       # Notification components
│   ├── admin/               # Admin controls
│   └── ui/                  # Reusable UI components
├── src/lib/                 # Utilities and services
│   ├── supabase/            # Supabase clients (server, browser)
│   ├── notifications.ts     # Notification service
│   ├── eventReminders.ts    # Event reminder service
│   ├── utils.ts             # Helper functions
│   └── constants.ts         # App constants
├── src/types/               # TypeScript type definitions
├── src/middleware.ts        # Authentication middleware
├── database/                # Database setup scripts
│   ├── setup.sql           # Main database schema
│   └── updates.sql         # Additional features
├── prisma/                  # Prisma schema (ORM)
├── public/                  # Static assets
└── configuration files      # Next.js, Tailwind, TypeScript, etc.
```

## Environment Variables

Create a `.env.local` file with:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Database Schema

### Core Tables
- `families` - Family groups with subscription tiers
- `users` - Family members with roles (extends Supabase auth)
- `chores` - Chores with assignment, points, status, due dates
- `events` - Calendar events with dates, times, reminders
- `messages` - Family communication with real-time support
- `notifications` - User notifications for events, chores, messages
- `rewards` - Reward catalog (foundation for Phase 2)
- `invites` - Family invitation system (additional setup)

### Security Features
- **Row Level Security (RLS)**: All tables protected
- **Role-based Access**: Parents vs children permissions
- **Family Isolation**: Users only see their own family data
- **Real-time Subscriptions**: Live updates for messages and notifications

## Development Roadmap

### 🎯 Phase 1: MVP Foundation (COMPLETE ✅)
- ✅ **Authentication**: Login, register, session management
- ✅ **Family Setup**: Create/join families, role-based permissions
- ✅ **Chore Management**: Create, assign, track, complete chores
- ✅ **Family Calendar**: Events, dates, times, reminders
- ✅ **Real-time Messaging**: Family chat with notifications
- ✅ **Notifications**: Smart reminders for chores and events
- ✅ **User Settings**: Profiles, preferences, theme selection
- ✅ **Responsive Design**: Mobile-first, works on all devices

### ⚡ Phase 2: Enhanced Features (Weeks 9-16)
- **Rewards System**: Points redemption, reward catalog
- **Recurring Chores**: Daily/weekly/monthly templates
- **Photo Sharing**: Upload and share family photos
- **Voice Messages**: Record and send voice notes
- **Shared Lists**: Grocery lists, meal planning
- **Advanced Analytics**: Family activity reports

### 📱 Phase 3: Mobile Expansion (Weeks 17-24)
- **React Native Apps**: iOS and Android
- **Push Notifications**: Mobile notifications
- **Location Features**: Check-in/check-out, safe zones
- **Calendar Sync**: Google/Apple Calendar integration
- **Offline Support**: Work without internet connection

### 💎 Phase 4: Premium Features (Weeks 25-32)
- **Advanced Analytics**: Detailed family insights
- **Family Wellness**: Mood tracking, conflict resolution
- **Extended Family**: Grandparent access, co-parenting tools
- **Subscription System**: Premium features monetization
- **Educational Content**: Age-appropriate learning modules

## Contributing

1. Create a feature branch
2. Make changes
3. Write tests
4. Submit pull request

## License

MIT