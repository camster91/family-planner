import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // Get user's family
    const { data: user } = await supabase
      .from('users')
      .select('family_id')
      .eq('id', session.user.id)
      .single()
    
    if (!user || !user.family_id) {
      return NextResponse.json({ error: 'User not in a family' }, { status: 400 })
    }
    
    // Get query parameters
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    
    // Build query
    let query = supabase
      .from('lists')
      .select('*, items:list_items(count), creator:users(name)')
      .eq('family_id', user.family_id)
      .order('updated_at', { ascending: false })
    
    if (type) {
      query = query.eq('type', type)
    }
    
    const { data: lists, error } = await query
    
    if (error) {
      console.error('Error fetching lists:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ lists })
    
  } catch (error) {
    console.error('Error fetching lists:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}