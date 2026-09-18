import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const

/**
 * Readiness probe — reports whether this instance can actually serve traffic.
 *
 * Returns 200 only when every dependency is verified. A degraded instance
 * returns **503** so the Docker HEALTHCHECK (`wget --spider`, which inspects
 * only the status code) fails and Coolify refuses to promote the deploy.
 *
 * For "is the process up?" use `/api/health/live`, which deliberately ignores
 * the database so a dependency outage does not read as a dead process.
 */
export async function GET() {
  const timestamp = new Date().toISOString()

  try {
    // Check environment variables
    const envVars = {
      databaseUrl: process.env.DATABASE_URL ? 'configured' : 'missing',
      jwtSecret: process.env.JWT_SECRET ? 'configured' : 'missing',
      appUrl: process.env.NEXT_PUBLIC_APP_URL ? 'configured' : 'missing',
      nodeEnv: process.env.NODE_ENV || 'development'
    }

    // Check database connection
    let dbStatus = 'disconnected'
    if (prisma) {
      try {
        await prisma.$queryRaw`SELECT 1`
        dbStatus = 'connected'
      } catch {
        dbStatus = 'error'
      }
    }

    // Determine overall status
    const status = dbStatus === 'connected' && envVars.databaseUrl === 'configured' && envVars.jwtSecret === 'configured'
      ? 'healthy'
      : 'degraded'

    return NextResponse.json({
      status,
      timestamp,
      service: 'family-planner-api',
      version: process.env.npm_package_version || '0.1.0',
      checks: {
        environment: envVars,
        database: dbStatus
      }
    }, {
      status: status === 'healthy' ? 200 : 503,
      headers: {
        ...NO_STORE,
        'X-Health-Check': timestamp
      }
    })

  } catch (error) {
    console.error('Health check error:', error)
    return NextResponse.json({
      status: 'degraded',
      timestamp,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, {
      status: 503,
      headers: NO_STORE
    })
  }
}
