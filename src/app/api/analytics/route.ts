import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

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
    
    // Get date ranges for analytics
    const now = new Date()
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    
    // Get family members
    const { data: familyMembers } = await supabase
      .from('users')
      .select('id, name, role')
      .eq('family_id', user.family_id)
    
    // Get all chores for the family
    const { data: allChores } = await supabase
      .from('chores')
      .select('*, assignee:users!chores_assigned_to_fkey(name)')
      .eq('family_id', user.family_id)
    
    // Get completed chores in the last 30 days
    const { data: recentCompletedChores } = await supabase
      .from('chores')
      .select('*, assignee:users!chores_assigned_to_fkey(name)')
      .eq('family_id', user.family_id)
      .in('status', ['completed', 'verified'])
      .gte('completed_at', oneMonthAgo.toISOString())
    
    // Get weekly completion data
    const weeklyData = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now.getTime() - (6 - i) * 24 * 60 * 60 * 1000)
      const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      const dateEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
      
      const dayChores = recentCompletedChores?.filter(chore => {
        if (!chore.completed_at) return false
        const completedDate = new Date(chore.completed_at)
        return completedDate >= dateStart && completedDate < dateEnd
      }) || []
      
      return {
        date: date.toISOString().split('T')[0],
        day: date.toLocaleDateString('en-US', { weekday: 'short' }),
        count: dayChores.length,
        points: dayChores.reduce((sum, chore) => sum + (chore.points || 0), 0)
      }
    })
    
    // Get member participation
    const memberParticipation = familyMembers?.map(member => {
      const memberChores = allChores?.filter(chore => chore.assigned_to === member.id) || []
      const completedChores = memberChores.filter(chore => 
        chore.status === 'completed' || chore.status === 'verified'
      )
      
      return {
        id: member.id,
        name: member.name,
        role: member.role,
        totalChores: memberChores.length,
        completedChores: completedChores.length,
        completionRate: memberChores.length > 0 
          ? Math.round((completedChores.length / memberChores.length) * 100)
          : 0,
        totalPoints: completedChores.reduce((sum, chore) => sum + (chore.points || 0), 0)
      }
    }) || []
    
    // Calculate family statistics
    const totalChores = allChores?.length || 0
    const completedChores = allChores?.filter(chore => 
      chore.status === 'completed' || chore.status === 'verified'
    ).length || 0
    const completionRate = totalChores > 0 
      ? Math.round((completedChores / totalChores) * 100)
      : 0
    
    // Calculate points statistics
    const totalPoints = completedChores > 0 
      ? allChores?.filter(chore => 
          chore.status === 'completed' || chore.status === 'verified'
        ).reduce((sum, chore) => sum + (chore.points || 0), 0) || 0
      : 0
    
    // Get most active day
    const dayCounts: Record<string, number> = {}
    recentCompletedChores?.forEach(chore => {
      if (chore.completed_at) {
        const day = new Date(chore.completed_at).toLocaleDateString('en-US', { weekday: 'long' })
        dayCounts[day] = (dayCounts[day] || 0) + 1
      }
    })
    
    const mostActiveDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]
    
    // Calculate streaks (simplified)
    const sortedCompletedDates = recentCompletedChores
      ?.map(chore => chore.completed_at ? new Date(chore.completed_at).toISOString().split('T')[0] : null)
      .filter(Boolean)
      .sort()
      .reverse() || []
    
    let currentStreak = 0
    if (sortedCompletedDates.length > 0) {
      const today = now.toISOString().split('T')[0]
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      
      // Check if we have completion today or yesterday for streak calculation
      if (sortedCompletedDates[0] === today) {
        currentStreak = 1
        for (let i = 1; i < sortedCompletedDates.length; i++) {
          const expectedDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          if (sortedCompletedDates[i] === expectedDate) {
            currentStreak++
          } else {
            break
          }
        }
      } else if (sortedCompletedDates[0] === yesterday) {
        currentStreak = 1
        // Check backwards from yesterday
        for (let i = 1; i < sortedCompletedDates.length; i++) {
          const expectedDate = new Date(now.getTime() - (i + 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          if (sortedCompletedDates[i] === expectedDate) {
            currentStreak++
          } else {
            break
          }
        }
      }
    }
    
    // Get top performers
    const topPerformers = [...memberParticipation]
      .sort((a, b) => b.completedChores - a.completedChores)
      .slice(0, 3)
    
    // Get chore difficulty distribution
    const difficultyDistribution = {
      easy: allChores?.filter(chore => chore.difficulty === 'easy').length || 0,
      medium: allChores?.filter(chore => chore.difficulty === 'medium').length || 0,
      hard: allChores?.filter(chore => chore.difficulty === 'hard').length || 0
    }
    
    return NextResponse.json({
      summary: {
        totalChores,
        completedChores,
        completionRate,
        totalPoints,
        currentStreak,
        mostActiveDay: mostActiveDay ? {
          day: mostActiveDay[0],
          count: mostActiveDay[1]
        } : null
      },
      weeklyTrend: weeklyData,
      memberParticipation,
      topPerformers,
      difficultyDistribution,
      recentActivity: recentCompletedChores?.slice(0, 10).map(chore => ({
        id: chore.id,
        title: chore.title,
        points: chore.points,
        completedAt: chore.completed_at,
        assignee: chore.assignee?.name
      })) || []
    })
    
  } catch (error) {
    console.error('Error fetching analytics:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}