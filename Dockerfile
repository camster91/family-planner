# syntax = docker/dockerfile:1

# Use the official Node.js 22 Alpine image as the base
FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
# Install exactly what package-lock.json records, with the same flags as the
# `Build & Test` CI gate (release.yml). `npm ci` fails if package.json and the
# lockfile disagree instead of silently re-resolving. Install scripts are
# skipped; the Prisma client is generated explicitly in the builder stage.
RUN npm ci --ignore-scripts --no-audit --no-fund

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set build-time environment variables with defaults
ARG NEXT_PUBLIC_APP_URL="https://family.ashbi.ca"
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV DATABASE_URL=${DATABASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Generate Prisma client
RUN npx prisma generate

# Build Next.js application
RUN npm run build

# Copy public files into standalone output so they're served by server.js
RUN cp -r /app/public /app/.next/standalone/public

# Production image
FROM base AS runner
WORKDIR /app

ARG RELEASE_SHA
ENV RELEASE_SHA=${RELEASE_SHA}
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Install wget for health checks and pg for migration script
RUN apk add --no-cache wget
# Keep this pin in step with the `pg` version in package-lock.json.
RUN npm install -g pg@8.23.0

# Create necessary directories and set permissions
RUN mkdir -p /app/.next/cache
RUN chown -R nextjs:nodejs /app/.next

# Copy public files
COPY --from=builder /app/public ./public

# Copy standalone Next.js output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy migration script
COPY --from=builder /app/scripts/migrate.js /app/scripts/migrate.js
COPY --from=builder /app/database /app/database

# Copy entrypoint script
COPY --chown=nextjs:nodejs docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV HOST="0.0.0.0"

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
