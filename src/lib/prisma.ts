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

if (process.env.NODE_ENV !== 'production' && prisma) {
  globalForPrisma.prisma = prisma
}