# Family Planner — Deployment Guide

## Deploy to Production (Docker + Coolify)

### Overview

Family Planner deploys to Coolify via source-build (Coolify pulls from git and builds) or via pre-built Docker image. The 7 GitHub Actions workflows handle CI, building, and triggering deploys.

### Prerequisites
- A Coolify instance (self-hosted or managed)
- A PostgreSQL database (provisioned via Coolify or external)
- GitHub repository connected to Coolify

## Deploy Methods

### Method 1: Coolify Source Build (Canonical Production Deploy)

Uses `.github/workflows/deploy.yml` — Coolify pulls from git, builds the Next.js standalone image directly.

1. **Connect your GitHub repo** in the Coolify dashboard
2. **Set build pack** to "Docker" (for Next.js standalone) or "Nixpacks" (auto-detects Node.js)
3. **Add environment variables:**
   - `DATABASE_URL` — PostgreSQL connection string
   - `JWT_SECRET` — Secret for JWT signing (≥32 chars)
   - `NEXT_PUBLIC_APP_URL` — Your production URL (e.g., `https://family.ashbi.ca`)
   - `NEXT_PUBLIC_APP_NAME` — App display name
   - `SKIP_ENV_VALIDATION=true` — Skip env validation during build
4. **Build command:** `npx prisma generate && npm run build`
5. **Start command:** `npm run start`
6. **Deploy** — Coolify builds and starts the container

### Method 2: Pre-built Image (ghcr.io)

Uses `.github/workflows/build-push.yml` + `.github/workflows/deploy-from-ghcr.yml`:

1. **Build and push:** `build-push.yml` builds the Docker image and pushes to `ghcr.io/camster91/family-planner`
2. **Deploy:** `deploy-from-ghcr.yml` tells Coolify to pull the new image and redeploy

```bash
# Manual image build and push
docker build -t ghcr.io/camster91/family-planner:latest .
docker push ghcr.io/camster91/family-planner:latest
```

### Method 3: Docker (local or VPS)

```bash
docker build -t family-planner .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e JWT_SECRET="your-secret" \
  -e NEXT_PUBLIC_APP_URL="https://family.ashbi.ca" \
  family-planner
```

## GitHub Actions Workflows

| Workflow | File | What it does |
|----------|------|--------------|
| CI | `ci.yml` | lint + type-check + test + docker build |
| Image push | `build-push.yml` | Build + push to `ghcr.io` |
| Image deploy | `deploy-from-ghcr.yml` | Pull image + redeploy to Coolify |
| Source deploy | `deploy.yml` | Trigger Coolify source build |
| Android APK | `apk.yml` | Capacitor Android build |
| Stale issues | `stale-issues.yml` | Auto-close stale issues |
| Auto-merge | `auto-merge.yml` | Auto-merge dependabot PRs |

### CI Pipeline (`ci.yml`)

1. Checkout → Setup Node 20
2. `npm ci --legacy-peer-deps`
3. `npx prisma generate` (with placeholder DATABASE_URL)
4. `SKIP_ENV_VALIDATION=true npm run build`
5. `npm test -- --passWithNoTests --ci`

### Deploy Flow

**Source build (deploy.yml):**
1. Checkout → Setup Node 20
2. `npm ci --legacy-peer-deps`
3. `npx prisma generate`
4. `SKIP_ENV_VALIDATION=true npm run build`
5. Trigger Coolify deploy via API webhook

**Image-based (build-push.yml + deploy-from-ghcr.yml):**
1. Build Docker image with `docker/build-push` action
2. Push to `ghcr.io/camster91/family-planner`
3. Coolify webhook triggers redeploy from new image tag

## Database Setup

### PostgreSQL

Provision via Coolify (built-in) or external provider.

```bash
# Push Prisma schema
npx prisma db push

# Or run SQL files manually
# database/setup.sql       — Initial schema
# database/updates.sql     — Phase updates
```

### Prisma

```bash
npx prisma generate   # Required before build (regenerate after every schema change)
npx prisma db push     # Push schema to database
npx prisma studio      # Browse data
```

## Environment Variables

### Required

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/family_planner
JWT_SECRET=your-secure-random-string-at-least-32-chars
NEXT_PUBLIC_APP_URL=https://family.ashbi.ca
NEXT_PUBLIC_APP_NAME=Family Planner
SKIP_ENV_VALIDATION=true   # Required during build (env vars may not be set)
```

### Coolify Environment Block

```
DATABASE_URL=<your postgres connection string>
JWT_SECRET=<generate with: openssl rand -base64 32>
NEXT_PUBLIC_APP_URL=https://family.ashbi.ca
NEXT_PUBLIC_APP_NAME=Family Planner
SKIP_ENV_VALIDATION=true
```

## Security Checklist

### Before Launch
- [ ] `JWT_SECRET` is strong (≥32 random chars, generated with `openssl rand -base64 32`)
- [ ] Database connections use SSL in production (`?sslmode=require` in DATABASE_URL)
- [ ] HTTPS configured via Coolify reverse proxy
- [ ] Rate limiting enabled on auth endpoints (`/api/auth/*`)
- [ ] Database backups configured

### Ongoing
- [ ] Regular dependency updates (`npm audit fix`)
- [ ] Monitor for suspicious activity in Coolify logs
- [ ] Database backups (daily recommended)
- [ ] Update Node.js base image periodically

## Monitoring

- **Error tracking**: Check Coolify logs + `docker logs` for errors
- **Uptime**: Use UptimeRobot or similar on `https://family.ashbi.ca`
- **Performance**: Lighthouse CI on key pages

## Scaling

- **High traffic**: Add container replicas in Coolify
- **Large database**: Consider read replicas (PostgreSQL)
- **International users**: Deploy to multiple regions

## Emergency Procedures

### Rollback
```bash
# Redeploy a previous commit via Coolify dashboard
# Or pull a specific ghcr.io tag
docker pull ghcr.io/camster91/family-planner:<previous-tag>
```

### Container crash
```bash
docker logs <container_id>       # Check logs
docker restart <container_id>   # Restart
```

### Build failure
Check GitHub Actions logs for the failing step. Common causes:
- `npx prisma generate` skipped after schema change → run it
- Missing env var during build → ensure `SKIP_ENV_VALIDATION=true`
- TypeScript errors → fix type errors before pushing

---

*Built by Cameron Ashley*