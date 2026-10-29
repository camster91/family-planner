import { storageBackend } from '@/lib/storage-backend'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { attachQueryTiming, queryTimingConfig } from '@/lib/db-query-timing'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function initializePrisma(): PrismaClient | undefined {
  const databaseUrl = process.env.DATABASE_URL || ''
  const hasDatabaseUrl = databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')

  if (!hasDatabaseUrl) {
    console.warn('DATABASE_URL not set or invalid, Prisma client will not be initialized')
    return undefined
  }

  try {
    // The adapter owns this pool, so $disconnect releases its connections and
    // a later query can reconnect. An externally supplied Pool is retained by
    // default, leaking connections across short-lived client lifecycles.
    const adapter = new PrismaPg({ connectionString: databaseUrl })
    // Opt-in, dev/test-only slow-query lines (#161, src/lib/db-query-timing.ts).
    // Off by default, and always off with NODE_ENV=production.
    const timing = queryTimingConfig()
    if (!timing) return new PrismaClient({ adapter })
    const client = new PrismaClient({ adapter, log: [{ emit: 'event', level: 'query' }] })
    attachQueryTiming(client, timing)
    return client as unknown as PrismaClient
  } catch (error) {
    console.error('Failed to initialize Prisma client:', error instanceof Error ? error.name : 'unknown error')
    return undefined
  }
}

// During the D1 conversion, unconverted routes must fail closed instead of
// mixing D1 account authority with records from the former PostgreSQL database.
export const prisma = storageBackend() === 'd1'
  ? undefined
  : globalForPrisma.prisma ?? initializePrisma()

// Cache per process, not only in dev.
//
// The dev-only cache was there to survive hot reload, but the client must also
// be shared across the two bundles that now both read it: `middleware.ts`
// checks the session generation, and middleware is compiled into its own module
// registry with its own copy of this file. Without a shared cache that is a
// SECOND `pg.Pool` — up to 10 more connections — against the same database.
if (prisma) {
  globalForPrisma.prisma = prisma
}