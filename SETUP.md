# Family Planner - Setup Guide

## Prerequisites

1. **Node.js 18+** - [Download](https://nodejs.org/)
2. **Git** - [Download](https://git-scm.com/)
3. **Supabase Account** - [Sign up](https://supabase.com/) (free tier)
4. **Code Editor** - VS Code recommended

## Step 1: Clone and Setup

```bash
# Clone the project (when available)
git clone <repository-url>
cd family-planner-app

# Install dependencies
npm install
```

## Step 2: Supabase Setup

1. Go to [Supabase Dashboard](https://app.supabase.com/)
2. Create a new project
3. Wait for database to initialize
4. Get your project URL and anon key from Settings > API

## Step 3: Environment Configuration

1. Copy the environment template:
```bash
cp .env.example .env.local
```

2. Edit `.env.local` with your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Step 4: Database Setup

### Option A: Use Prisma (Recommended)
```bash
# Install Prisma CLI globally (if not already installed)
npm install -g prisma

# Generate Prisma client
npx prisma generate

# Push schema to Supabase
npx prisma db push
```

### Option B: Use SQL directly
1. Go to Supabase SQL Editor
2. Run the SQL from `database/setup.sql` (when available)

## Step 5: Run the Application

```bash
# Development mode
npm run dev

# Open http://localhost:3000
```

## Step 6: Create Your First Family

1. Open http://localhost:3000
2. Click "Start Free Trial"
3. Register with your email
4. Create your first family
5. Invite family members

## Development Workflow

### Daily Development
```bash
# Start development server
npm run dev

# Run tests
npm test

# Type checking
npm run type-check

# Lint code
npm run lint

# Format code
npm run format
```

### Git Workflow
```bash
# Create feature branch
git checkout -b feature/new-feature

# Make changes and commit
git add .
git commit -m "Add new feature"

# Push to remote
git push origin feature/new-feature

# Create pull request
```

## Project Structure

```
family-planner-app/
├── src/app/              # Next.js App Router pages
├── src/components/       # React components
├── src/lib/             # Utilities, Supabase client
├── src/types/           # TypeScript types
├── prisma/              # Database schema
├── public/              # Static assets
└── tests/               # Test files
```

## Key Files

- `src/middleware.ts` - Authentication middleware
- `src/lib/supabase/` - Supabase client configuration
- `src/types/index.ts` - TypeScript type definitions
- `prisma/schema.prisma` - Database schema
- `tailwind.config.js` - Tailwind CSS configuration

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- src/components/ChoreList.test.tsx
```

## Deployment

### Vercel (Recommended)
1. Push code to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy

### Manual Build
```bash
# Build for production
npm run build

# Start production server
npm start
```

## Common Issues

### 1. Authentication Errors
- Verify Supabase URL and keys are correct
- Check CORS settings in Supabase
- Ensure email confirmation is set up

### 2. Database Connection Issues
- Verify DATABASE_URL in environment
- Check if Prisma schema matches database
- Run `npx prisma db push` to sync schema

### 3. Build Errors
- Clear `.next` directory: `rm -rf .next`
- Reinstall dependencies: `rm -rf node_modules && npm install`
- Check TypeScript errors: `npm run type-check`

## Next Steps After Setup

1. **Explore the dashboard** - Familiarize yourself with the interface
2. **Create test family** - Add family members and chores
3. **Test features** - Try chore assignment, calendar, messaging
4. **Review code structure** - Understand how components work together
5. **Start developing** - Begin with Phase 1 features

## Getting Help

- Check the `docs/` directory for more documentation
- Review TypeScript types in `src/types/`
- Look at existing components for patterns
- Use browser dev tools for debugging

## Phase 1 Development Priorities

1. **Week 1-2:** Authentication & family setup
2. **Week 3-4:** Chore management
3. **Week 5-6:** Calendar & messaging
4. **Week 7-8:** Polish & testing

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [React Documentation](https://react.dev)