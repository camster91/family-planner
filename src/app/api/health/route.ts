import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const timestamp = new Date().toISOString()

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

    // Always return 200 for Docker health check
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
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Health-Check': timestamp
      }
    })

  } catch (error) {
    console.error('Health check error:', error)
    return NextResponse.json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    }, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0'
      }
    })
  }
}