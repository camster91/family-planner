import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function initializePrisma() {
  const databaseUrl = process.env.DATABASE_URL || ''
  const hasDatabaseUrl = databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')

  if (!hasDatabaseUrl) {
    console.warn('DATABASE_URL not set or invalid, Prisma client will not be initialized')
    return undefined
  }

  try {
    const pool = new pg.Pool({ connectionString: databaseUrl })
    const adapter = new PrismaPg(pool)
    return new PrismaClient({ adapter })
  } catch (error) {
    console.error('Failed to initialize Prisma client:', error)
    return undefined
  }
}

export const prisma = globalForPrisma.prisma ?? initializePrisma()

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