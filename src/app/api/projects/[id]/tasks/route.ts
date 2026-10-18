import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { createProjectTaskSchema } from '@/lib/validations'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { authorizeProjectReplay, createProjectTaskWithReceipt, projectAction } from '@/lib/project-mutations'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

// GET — List tasks for a project (family-scoped via project)
export async function GET(request: NextRequest, context: RouteContext) {
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

    // The project is looked up with the caller's household: another
    // household's project is the same 404 as a missing one (#289).
    const project = await prisma!.project.findFirst({
      where: { id: projectId, family_id: auth.user.family_id },
      select: { id: true },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    const { searchParams } = new URL(request.url)
    const filterCompleted = searchParams.get('completed')

    const where: Record<string, unknown> = { project_id: projectId }

    if (filterCompleted === 'true') {
      where.completed = true
    } else if (filterCompleted === 'false') {
      where.completed = false
    }

    const tasks = await prisma!.projectTask.findMany({
      where,
      include: {
        assignee: {
          select: { id: true, name: true, avatar_url: true },
        },
      },
      orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
    })

    return NextResponse.json({ tasks })
  } catch (error) {
    logRouteError('GET /api/projects/[id]/tasks', error, getRequestId(request))
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST — Create a new task within a project. Any household member (parent,
// teen, child); the "Add task" form on /dashboard/projects/[id] calls it
// (route inventory F-5, #289). Active projects only.
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

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = createProjectTaskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: projectAction('task.create', projectId),
      },
      parsed.data,
      ({ recordId }) =>
        createProjectTaskWithReceipt(
          prisma!,
          projectId,
          parsed.data,
          { familyId: auth.user.family_id, userId: auth.user.id },
          recordId,
        ),
      {
        beforeReplay: () =>
          authorizeProjectReplay(
            prisma!,
            'task.create',
            { familyId: auth.user.family_id, userId: auth.user.id },
            projectId,
          ),
      },
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    logRouteError('POST /api/projects/[id]/tasks', error, getRequestId(request))
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
