# syntax = docker/dockerfile:1

# Use the official Node.js 20 Alpine image as the base
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

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

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Install wget for health checks and pg client for migrations
RUN apk add --no-cache wget

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

# Copy pg module for migration script (from builder's node_modules)
COPY --from=builder /app/node_modules/pg /app/node_modules/pg
COPY --from=builder /app/node_modules/pg-connection-string /app/node_modules/pg-connection-string
COPY --from=builder /app/node_modules/pg-pool /app/node_modules/pg-pool
COPY --from=builder /app/node_modules/pg-types /app/node_modules/pg-types
COPY --from=builder /app/node_modules/pg-protocol /app/node_modules/pg-protocol
COPY --from=builder /app/node_modules/buffer-encoder /app/node_modules/buffer-encoder
COPY --from=builder /app/node_modules/pg-pass /app/node_modules/pg-pass
COPY --from=builder /app/node_modules/split2 /app/node_modules/split2

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