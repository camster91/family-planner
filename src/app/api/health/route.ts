import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const timestamp = new Date().toISOString()
    
    // Check database connection
    let dbStatus = 'healthy'
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch (error) {
      dbStatus = 'unhealthy'
      console.error('Database health check failed:', error)
    }
    
    // Check environment variables
    const envVars = {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'configured' : 'missing',
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'configured' : 'missing',
      appUrl: process.env.NEXT_PUBLIC_APP_URL ? 'configured' : 'missing',
      nodeEnv: process.env.NODE_ENV || 'development'
    }
    
    const status = dbStatus === 'healthy' ? 'healthy' : 'degraded'
    
    return NextResponse.json({
      status,
      timestamp,
      service: 'family-planner-api',
      version: process.env.npm_package_version || '0.1.0',
      checks: {
        database: dbStatus,
        environment: envVars
      }
    }, {
      status: status === 'healthy' ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Health-Check': timestamp
      }
    })
    
  } catch (error) {
    console.error('Health check error:', error)
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    }, {
      status: 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0'
      }
    })
  }
}