# Family Planner - Deployment Guide

## Deploy to Production (Docker + Coolify)

### Prerequisites
- A Coolify instance (self-hosted or managed)
- A PostgreSQL database (provisioned via Coolify or external)
- GitHub repository connected to Coolify

### 1. Docker Build

The app uses a multi-stage Dockerfile with Next.js standalone output. The production image runs as a non-root `nextjs` user.

```dockerfile
# Already included in the repo as Dockerfile
# Key points:
# - Base: node:20-alpine
# - Standalone Next.js output
# - Runs on port 3000
# - Non-root user for security
```

To build and test locally:

```bash
docker build -t family-planner .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e JWT_SECRET="your-secret" \
  family-planner
```

### 2. Coolify Deployment

1. **Connect your GitHub repo** in the Coolify dashboard
2. **Set build pack** to Docker
3. **Add environment variables:**
   - `DATABASE_URL` - PostgreSQL connection string
   - `JWT_SECRET` - Secret for JWT signing
   - `NEXT_PUBLIC_APP_URL` - Your production URL (e.g., `https://planner.yourdomain.com`)
4. **Deploy** - Coolify will build the Docker image and start the container

### 3. CI/CD via GitHub Actions

The repo includes `.github/workflows/deploy.yml` which:

1. Checks out code and sets up Node 20
2. Runs `npm ci --legacy-peer-deps`
3. Generates Prisma client
4. Builds the Next.js app
5. Runs tests
6. Triggers Coolify deployment via API webhook

## Database Setup

### PostgreSQL

Provision a PostgreSQL database (Coolify can create one for you, or use an external provider).

```bash
# Push the Prisma schema to your database
npx prisma db push

# Or run the SQL files manually:
# database/setup.sql       - Initial schema
# database/updates.sql     - Migrations
# database/phase2-updates.sql - Phase 2 additions
```

### Prisma

```bash
# Generate the Prisma client (required before build)
npx prisma generate

# Push schema changes to database
npx prisma db push

# Open Prisma Studio to browse data
npx prisma studio
```

## Environment Variables

Create `.env.local` for local development or set these in Coolify:

```env
# Database (required)
DATABASE_URL=postgresql://user:password@localhost:5432/family_planner

# Auth (required)
JWT_SECRET=your-secure-random-string

# App URL
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

## Security Checklist

### Before Launch
- [ ] Set a strong `JWT_SECRET` (at least 32 characters)
- [ ] Use SSL/TLS for database connections
- [ ] Configure HTTPS via Coolify reverse proxy
- [ ] Set up rate limiting
- [ ] Configure CORS properly
- [ ] Set up database backups

### Ongoing
- [ ] Regular security updates
- [ ] Monitor for suspicious activity
- [ ] Regular database backups
- [ ] Update dependencies monthly

## Monitoring & Analytics

### Essential Monitoring
1. **Error Tracking**: Sentry or LogRocket
2. **Performance**: Lighthouse CI
3. **Uptime**: UptimeRobot or Pingdom
4. **Database**: Monitor via Prisma or pg_stat

## Scaling Considerations

### Performance Optimization
1. **Database Indexes**: Add indexes on frequently queried columns
2. **Image Optimization**: Use next/image component
3. **Code Splitting**: Automatic with Next.js
4. **Standalone Output**: Minimal production bundle

### When to Scale
- **High traffic**: Add container replicas in Coolify
- **Large database**: Consider read replicas
- **International users**: Deploy to multiple regions

## Emergency Procedures

### Database Issues
1. **Backup restore**: Restore from your PostgreSQL backup
2. **Performance issues**: Check slow queries with `pg_stat_statements`
3. **Connection issues**: Verify `DATABASE_URL` and network access

### App Issues
1. **Rollback**: Redeploy a previous commit in Coolify
2. **Container crash**: Check logs via `docker logs` or Coolify dashboard
3. **Build failure**: Check GitHub Actions logs

---
*Built by Cameron Ashley / Nexus AI.*
