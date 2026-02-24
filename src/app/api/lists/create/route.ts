import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { name, type, description } = await request.json()
    
    if (!name || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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
    
    // Create the list
    const { data: list, error } = await supabase
      .from('lists')
      .insert({
        family_id: user.family_id,
        name,
        type,
        description: description || null,
        created_by: session.user.id,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()
    
    if (error) {
      console.error('Error creating list:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ success: true, list })
    
  } catch (error) {
    console.error('Error creating list:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}