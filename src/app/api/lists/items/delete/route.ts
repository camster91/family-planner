import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get('itemId')
    
    if (!itemId) {
      return NextResponse.json({ error: 'Missing itemId' }, { status: 400 })
    }
    
    // Get the item to verify access and get list_id
    const { data: item, error: itemError } = await supabase
      .from('list_items')
      .select('list_id, lists(family_id)')
      .eq('id', itemId)
      .single()
    
    if (itemError) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }
    
    // Check if user is in the same family
    const { data: user } = await supabase
      .from('users')
      .select('family_id')
      .eq('id', session.user.id)
      .single()
    
    if (!user || user.family_id !== (item.lists as any).family_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    
    // Delete the list item
    const { error: deleteError } = await supabase
      .from('list_items')
      .delete()
      .eq('id', itemId)
    
    if (deleteError) {
      console.error('Error deleting list item:', deleteError)
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }
    
    // Update list's updated_at timestamp
    await supabase
      .from('lists')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', item.list_id)
    
    return NextResponse.json({ success: true })
    
  } catch (error) {
    console.error('Error deleting list item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}