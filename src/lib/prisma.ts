import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Initialize Prisma client only if we have a DATABASE_URL
// This prevents initialization errors during build
function initializePrisma() {
  // Check if we have a DATABASE_URL that looks valid
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

// Create or get Prisma client instance
export const prisma = globalForPrisma.prisma ?? initializePrisma()

// Store in global for hot reload in development
if (process.env.NODE_ENV !== 'production' && prisma) {
  globalForPrisma.prisma = prisma
}