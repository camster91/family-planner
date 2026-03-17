import { PrismaClient } from '@prisma/client'

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
    return new PrismaClient()
  } catch (error) {
    console.error('Failed to initialize Prisma client:', error)
    return undefined
  }
}

export const prisma = globalForPrisma.prisma ?? initializePrisma()

if (process.env.NODE_ENV !== 'production' && prisma) {
  globalForPrisma.prisma = prisma
}
