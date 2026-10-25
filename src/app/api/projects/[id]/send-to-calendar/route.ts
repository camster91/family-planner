import { lockUser, lockHousehold } from "@/lib/household-lock";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { DEFAULT_FAMILY_TIMEZONE, isValidTimeZone } from '@/lib/calendar-import/timezone'
import { allDayRange, lockProjectRow, projectTaskUid, readProjectCalendarTaskBatch, PROJECT_CALENDAR_TASK_BATCH } from '@/lib/project-calendar'

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
      // Same lifecycle order as canonical project writes: user, household,
      // then project. The HTTP snapshot is not permission to write later.
      await lockUser(tx, auth.user.id)
      await lockHousehold(tx, auth.user.family_id)
      // Row locks also serialize session/feature updates that use SQL writes.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${auth.user.id} FOR UPDATE`
      await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${auth.user.family_id} FOR UPDATE`
      const [actor, family] = await Promise.all([
        tx.user.findUnique({ where: { id: auth.user.id }, select: { family_id: true, role: true, token_version: true } }),
        tx.family.findUnique({ where: { id: auth.user.family_id }, select: { features: true } }),
      ])
      if (!actor || actor.token_version !== (auth.payload.tv ?? 0))
        return { kind: 'refused' as const, status: 401, body: {
          code: 'SESSION_CHANGED', error: 'Sign in again before sending project tasks to the calendar.',
        } }
      if (!family || actor.family_id !== auth.user.family_id || !['parent', 'teen', 'child'].includes(actor.role))
        return { kind: 'refused' as const, status: 403, body: {
          code: 'PROJECT_SEND_UNAVAILABLE', error: 'This household project can no longer be sent. Refresh the project.',
        } }
      if (!isFeatureEnabled(normalizeFeatures(family.features), 'projects'))
        return { kind: 'refused' as const, status: 403, body: {
          code: 'FEATURE_DISABLED', error: 'Projects is turned off for this household.',
        } }
      await lockProjectRow(tx, projectId)
      const currentProject = await tx.project.findFirst({
        where: { id: projectId, family_id: auth.user.family_id }, select: { id: true, name: true },
      })
      if (!currentProject)
        return { kind: 'refused' as const, status: 404, body: {
          code: 'PROJECT_NOT_FOUND', error: 'Project not found',
        } }

      // Preserve one full-intent transaction; batch only internal reads, never
      // commit a prefix or silently stop after the first candidate page.
      let afterId: string | null = null
      let hadTasks = false
      const events: Array<{ id: string; title: string; start_time: Date; end_time: Date }> = []
      while (true) {
        const batch = await readProjectCalendarTaskBatch(tx, {
          familyId: auth.user.family_id, projectId,
        }, afterId)
        if (batch.tasks.length === 0) break
        hadTasks = true
        for (const task of batch.unsent) {
          const { start, end } = allDayRange(task.due_date!, timeZone)
          events.push(
            await tx.event.create({
              data: {
                family_id: auth.user.family_id,
                title: task.title,
                description: task.description || `Task from project: ${currentProject.name}`,
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
        const last = batch.tasks[batch.tasks.length - 1].id
        if (last === afterId) throw new Error('Project calendar task cursor did not advance')
        afterId = last
        if (batch.tasks.length < PROJECT_CALENDAR_TASK_BATCH) break
      }
      if (!hadTasks) return { kind: 'no-tasks' as const }
      if (events.length === 0) return { kind: 'all-sent' as const }
      return { kind: 'created' as const, events }
    // Inserts run one by one inside the lock; allow more than Prisma's 5 s
    // default for a project with many dated tasks.
    }, { timeout: 30_000 })

    if (outcome.kind === 'refused') {
      return NextResponse.json(outcome.body, { status: outcome.status, headers: { 'Cache-Control': 'private, no-store' } })
    }
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
