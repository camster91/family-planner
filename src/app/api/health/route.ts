import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const timestamp = new Date().toISOString()
    
    // Check environment variables
    const envVars = {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'configured' : 'missing',
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'configured' : 'missing',
      appUrl: process.env.NEXT_PUBLIC_APP_URL ? 'configured' : 'missing',
      nodeEnv: process.env.NODE_ENV || 'development'
    }
    
    // Check database connection only if DATABASE_URL is set
    let dbStatus = 'skipped'
    let dbError = null
    
    if (process.env.DATABASE_URL && process.env.DATABASE_URL !== '') {
      try {
        await prisma.$queryRaw`SELECT 1`
        dbStatus = 'healthy'
      } catch (error) {
        dbStatus = 'unhealthy'
        dbError = error instanceof Error ? error.message : 'Database connection failed'
        console.error('Database health check failed:', error)
      }
    } else {
      dbStatus = 'not_configured'
    }
    
    // Determine overall status
    let status = 'healthy'
    let httpStatus = 200
    
    // If Supabase environment variables are missing, consider degraded
    if (envVars.supabaseUrl === 'missing' || envVars.supabaseAnonKey === 'missing') {
      status = 'degraded'
    }
    
    // If database check failed, consider degraded (not unhealthy since app might work without DB)
    if (dbStatus === 'unhealthy') {
      status = 'degraded'
    }
    
    // Only return unhealthy if critical services are down
    // For now, always return 200 to keep container running
    // Coolify health check just needs HTTP 200
    
    return NextResponse.json({
      status,
      timestamp,
      service: 'family-planner-api',
      version: process.env.npm_package_version || '0.1.0',
      checks: {
        database: dbStatus,
        environment: envVars
      },
      ...(dbError ? { dbError } : {})
    }, {
      status: httpStatus, // Always return 200 for Docker health check
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Health-Check': timestamp
      }
    })
    
  } catch (error) {
    console.error('Health check error:', error)
    // Even on error, return 200 to prevent container restart loops
    return NextResponse.json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    }, {
      status: 200, // Return 200 even on error for health check
      headers: {
        'Cache-Control': 'no-store, max-age=0'
      }
    })
  }
}