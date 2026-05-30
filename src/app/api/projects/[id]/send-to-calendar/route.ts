import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

// POST — Create calendar events from incomplete project tasks
// Each incomplete task with a due_date becomes a 30-minute event on that date
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id: projectId } = await context.params

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }

    // Verify the project exists and belongs to the user's family
    const project = await prisma!.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        family_id: true,
        name: true,
        color: true,
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    const familyError = requireFamilyMatch(
      project.family_id,
      auth.user.family_id
    )
    if (familyError) return familyError

    // Fetch all incomplete tasks that have a due_date
    const tasks = await prisma!.projectTask.findMany({
      where: {
        project_id: projectId,
        completed: false,
        due_date: { not: null },
      },
    })

    if (tasks.length === 0) {
      return NextResponse.json({
        message: 'No incomplete tasks with due dates found',
        eventsCreated: 0,
        events: [],
      })
    }

    // Check for existing events already linked to this project and task-like
    // (to avoid creating duplicates — events with is_task=true and project_id set)
    const existingTaskTitles = new Set(
      (
        await prisma!.event.findMany({
          where: {
            project_id: projectId,
            is_task: true,
          },
          select: { title: true },
        })
      ).map((e) => e.title)
    )

    // Filter out tasks that already have calendar events
    const tasksToCreate = tasks.filter(
      (task) => !existingTaskTitles.has(task.title)
    )

    if (tasksToCreate.length === 0) {
      return NextResponse.json({
        message: 'All incomplete tasks are already on the calendar',
        eventsCreated: 0,
        events: [],
      })
    }

    // Create calendar events for each remaining task
    const createdEvents = await Promise.all(
      tasksToCreate.map(async (task) => {
        const startTime = task.due_date!
        // 30-minute event window
        const endTime = new Date(startTime.getTime() + 30 * 60 * 1000)

        return prisma!.event.create({
          data: {
            family_id: auth.user.family_id,
            title: task.title,
            description: task.description || `Task from project: ${project.name}`,
            start_time: startTime,
            end_time: endTime,
            event_type: 'other',
            is_task: true,
            project_id: projectId,
            created_by: auth.user.id,
          },
          select: {
            id: true,
            title: true,
            start_time: true,
            end_time: true,
          },
        })
      })
    )

    return NextResponse.json({
      message: `Created ${createdEvents.length} calendar event(s)`,
      eventsCreated: createdEvents.length,
      events: createdEvents,
    })
  } catch (error) {
    console.error('Error sending tasks to calendar:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
