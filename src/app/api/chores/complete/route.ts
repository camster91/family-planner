import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { notificationServiceServer } from '@/lib/notifications-server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { choreId, photoUrl } = await request.json()
    
    if (!choreId) {
      return NextResponse.json({ error: 'Missing choreId' }, { status: 400 })
    }
    
    // Get the chore details
    const { data: chore, error: choreError } = await supabase
      .from('chores')
      .select('*, assignee:users!chores_assigned_to_fkey(*), creator:users!chores_created_by_fkey(*)')
      .eq('id', choreId)
      .single()
    
    if (choreError) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }
    
    // Update chore status to completed
    const updateData: any = { 
      status: 'completed',
      completed_at: new Date().toISOString()
    }
    
    if (photoUrl) {
      updateData.photo_url = photoUrl
      updateData.photo_verified = false // Requires parent verification
    }
    
    const { error: updateError } = await supabase
      .from('chores')
      .update(updateData)
      .eq('id', choreId)
    
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
    
    // Send notification about chore completion
    if (chore.assignee && chore.creator) {
      await notificationServiceServer.notifyChoreCompletion(
        chore,
        chore.assignee
      )
    }
    
    // Handle recurring chores
    if (chore.frequency && chore.frequency !== 'once') {
      await createNextRecurringChore(chore)
    }
    
    return NextResponse.json({ success: true, choreId })
    
  } catch (error) {
    console.error('Error completing chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function createNextRecurringChore(chore: any) {
  const supabase = await createClient()
  
  const dueDate = new Date(chore.due_date)
  let nextDueDate: Date
  
  switch (chore.frequency) {
    case 'daily':
      nextDueDate = new Date(dueDate)
      nextDueDate.setDate(nextDueDate.getDate() + 1)
      break
    case 'weekly':
      nextDueDate = new Date(dueDate)
      nextDueDate.setDate(nextDueDate.getDate() + 7)
      break
    case 'monthly':
      nextDueDate = new Date(dueDate)
      nextDueDate.setMonth(nextDueDate.getMonth() + 1)
      break
    default:
      return
  }
  
  // Create next instance
  const { error } = await supabase
    .from('chores')
    .insert({
      family_id: chore.family_id,
      title: chore.title,
      description: chore.description,
      points: chore.points,
      assigned_to: chore.assigned_to,
      due_date: nextDueDate.toISOString(),
      status: 'pending',
      frequency: chore.frequency,
      difficulty: chore.difficulty,
      created_by: chore.created_by,
    })
  
  if (error) {
    console.error('Error creating recurring chore:', error)
  }
}