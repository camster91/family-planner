import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { DEFAULT_FAMILY_TIMEZONE, isValidTimeZone } from '@/lib/calendar-import/timezone'
import { allDayRange, lockProjectRow, projectTaskUid } from '@/lib/project-calendar'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

// POST — Create calendar events from incomplete project tasks.
// Each incomplete task with a due_date becomes an all-day event on that
// calendar day. Optional body: `{ timeZone }` (the caller's IANA zone);
// otherwise the household default zone is used.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'projects')
    if (gate) return gate

    const { id: projectId } = await context.params

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }

    // The body is optional; an unknown or missing zone falls back to the default.
    let timeZone = DEFAULT_FAMILY_TIMEZONE
    try {
      const body = await request.json()
      const requested = body && typeof body === 'object' ? (body as { timeZone?: unknown }).timeZone : undefined
      if (typeof requested === 'string' && isValidTimeZone(requested)) timeZone = requested
    } catch {
      // No or invalid JSON body: keep the default zone.
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

    // Read what is already sent and create the rest under a lock on the
    // project row, in one transaction, so concurrent sends cannot both create
    // the same events.
    const outcome = await prisma!.$transaction(async (tx) => {
      await lockProjectRow(tx, projectId)

      // Fetch all incomplete tasks that have a due_date
      const tasks = await tx.projectTask.findMany({
        where: {
          project_id: projectId,
          completed: false,
          due_date: { not: null },
        },
      })
      if (tasks.length === 0) return { kind: 'no-tasks' as const }

      // Skip tasks already on the calendar. New events carry a stable link to
      // their task (source_uid). Events sent before that link existed have no
      // source_uid; for those only, a matching title still counts as sent so a
      // re-send after upgrade does not duplicate them.
      const existing = await tx.event.findMany({
        where: {
          family_id: auth.user.family_id,
          project_id: projectId,
          is_task: true,
        },
        select: { title: true, source_uid: true },
      })
      const linkedUids = new Set(existing.map((e) => e.source_uid).filter((uid): uid is string => !!uid))
      const legacyTitles = new Set(existing.filter((e) => !e.source_uid).map((e) => e.title))

      const tasksToCreate = tasks.filter(
        (task) => !linkedUids.has(projectTaskUid(task.id)) && !legacyTitles.has(task.title)
      )
      if (tasksToCreate.length === 0) return { kind: 'all-sent' as const }

      // Create calendar events for each remaining task
      const events = []
      for (const task of tasksToCreate) {
        const { start, end } = allDayRange(task.due_date!, timeZone)
        events.push(
          await tx.event.create({
            data: {
              family_id: auth.user.family_id,
              title: task.title,
              description: task.description || `Task from project: ${project.name}`,
              start_time: start,
              end_time: end,
              event_type: 'other',
              is_task: true,
              project_id: projectId,
              source_uid: projectTaskUid(task.id),
              created_by: auth.user.id,
            },
            select: {
              id: true,
              title: true,
              start_time: true,
              end_time: true,
            },
          })
        )
      }
      return { kind: 'created' as const, events }
    // Inserts run one by one inside the lock; allow more than Prisma's 5 s
    // default for a project with many dated tasks.
    }, { timeout: 30_000 })

    if (outcome.kind === 'no-tasks') {
      return NextResponse.json({
        message: 'No incomplete tasks with due dates found',
        eventsCreated: 0,
        events: [],
      })
    }
    if (outcome.kind === 'all-sent') {
      return NextResponse.json({
        message: 'All incomplete tasks are already on the calendar',
        eventsCreated: 0,
        events: [],
      })
    }

    return NextResponse.json({
      message: `Created ${outcome.events.length} calendar event(s)`,
      eventsCreated: outcome.events.length,
      events: outcome.events,
    })
  } catch (error) {
    logRouteError('POST /api/projects/[id]/send-to-calendar', error, getRequestId(request))
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
