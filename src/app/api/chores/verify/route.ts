import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { notificationServiceServer } from '@/lib/notifications-server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { choreId, verificationNotes } = await request.json()
    
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
    
    // Update chore status to verified
    const updateData: any = { 
      status: 'verified',
      verified_at: new Date().toISOString()
    }
    
    // If chore has photo, mark it as verified
    if (chore.photo_url) {
      updateData.photo_verified = true
    }
    
    // Add verification notes if provided
    if (verificationNotes) {
      updateData.verification_notes = verificationNotes
    }
    
    const { error: updateError } = await supabase
      .from('chores')
      .update(updateData)
      .eq('id', choreId)
    
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
    
    // Send notification about chore verification
    if (chore.assignee) {
      await notificationServiceServer.sendNotification({
        userId: chore.assignee.id,
        title: 'Chore Verified! 🎉',
        message: `Your chore "${chore.title}" has been verified by a parent.`,
        type: 'reward'
      })
    }
    
    return NextResponse.json({ success: true, choreId })
    
  } catch (error) {
    console.error('Error verifying chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}