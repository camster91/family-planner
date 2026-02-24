import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { itemId, checked, content, quantity, category, notes } = await request.json()
    
    if (!itemId) {
      return NextResponse.json({ error: 'Missing itemId' }, { status: 400 })
    }
    
    // Get the item to verify access
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
    
    // Build update object
    const updateData: any = {
      updated_at: new Date().toISOString(),
    }
    
    if (typeof checked === 'boolean') {
      updateData.checked = checked
      if (checked) {
        updateData.checked_by = session.user.id
        updateData.checked_at = new Date().toISOString()
      } else {
        updateData.checked_by = null
        updateData.checked_at = null
      }
    }
    
    if (content !== undefined) updateData.content = content
    if (quantity !== undefined) updateData.quantity = quantity
    if (category !== undefined) updateData.category = category
    if (notes !== undefined) updateData.notes = notes
    
    // Update the list item
    const { data: updatedItem, error: updateError } = await supabase
      .from('list_items')
      .update(updateData)
      .eq('id', itemId)
      .select()
      .single()
    
    if (updateError) {
      console.error('Error updating list item:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
    
    // Update list's updated_at timestamp
    await supabase
      .from('lists')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', item.list_id)
    
    return NextResponse.json({ success: true, item: updatedItem })
    
  } catch (error) {
    console.error('Error updating list item:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}