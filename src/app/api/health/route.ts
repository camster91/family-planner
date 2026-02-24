import { NextResponse } from 'next/server'

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
    
    // Determine overall status
    let status = 'healthy'
    
    // If Supabase environment variables are missing, consider degraded
    if (envVars.supabaseUrl === 'missing' || envVars.supabaseAnonKey === 'missing') {
      status = 'degraded'
    }
    
    // Always return 200 for Docker health check
    // Coolify health check just needs HTTP 200 to consider container healthy
    return NextResponse.json({
      status,
      timestamp,
      service: 'family-planner-api',
      version: process.env.npm_package_version || '0.1.0',
      checks: {
        environment: envVars
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
    // Even on error, return 200 to prevent container restart loops
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