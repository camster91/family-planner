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
    
    const { listId, content, quantity, category, notes } = await request.json()
    
    if (!listId || !content) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    
    // Verify user has access to the list
    const { data: list, error: listError } = await supabase
      .from('lists')
      .select('family_id')
      .eq('id', listId)
      .single()
    
    if (listError) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 })
    }
    
    // Check if user is in the same family
    const { data: user } = await supabase
      .from('users')
      .select('family_id')
      .eq('id', session.user.id)
      .single()
    
    if (!user || user.family_id !== list.family_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    
    // Get current max position
    const { data: maxPosition } = await supabase
      .from('list_items')
      .select('position')
      .eq('list_id', listId)
      .order('position', { ascending: false })
      .limit(1)
    
    const nextPosition = (maxPosition?.[0]?.position || 0) + 1
    
    // Create the list item
    const { data: item, error } = await supabase
      .from('list_items')
      .insert({
        list_id: listId,
        content,
        quantity: quantity || 1,
        category: category || null,
        notes: notes || null,
        added_by: session.user.id,
        position: nextPosition,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()
    
    if (error) {
      console.error('Error creating list item:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    // Update list's updated_at timestamp
    await supabase
      .from('lists')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', listId)
    
    return NextResponse.json({ success: true, item })
    
  } catch (error) {
    console.error('Error creating list item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}