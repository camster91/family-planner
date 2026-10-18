import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { createProjectSchema } from '@/lib/validations'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { authorizeProjectReplay, createProjectWithReceipt, projectAction } from '@/lib/project-mutations'

export const dynamic = 'force-dynamic'

// GET — List projects for the user's family with task counts
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'projects')
    if (gate) return gate

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as 'active' | 'completed' | 'archived' | null

    const where: Record<string, unknown> = {
      family_id: auth.user.family_id,
    }

    if (status && ['active', 'completed', 'archived'].includes(status)) {
      where.status = status
    }

    const projects = await prisma!.project.findMany({
      where,
      include: {
        creator: {
          select: { id: true, name: true, avatar_url: true },
        },
        _count: {
          select: { tasks: true },
        },
        tasks: {
          where: { completed: true },
          select: { id: true },
        },
      },
      orderBy: { created_at: 'desc' },
    })

    // Transform to include computed task counts
    const result = projects.map((project) => {
      const { tasks, _count, ...rest } = project
      return {
        ...rest,
        taskCount: _count.tasks,
        completedTaskCount: tasks.length,
      }
    })

    return NextResponse.json({ projects: result })
  } catch (error) {
    logRouteError('GET /api/projects', error, getRequestId(request))
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST — Create a new project
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'projects')
    if (gate) return gate

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = createProjectSchema.safeParse(body)
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
        action: projectAction('create'),
      },
      parsed.data,
      ({ recordId }) =>
        createProjectWithReceipt(
          prisma!,
          parsed.data,
          { familyId: auth.user.family_id, userId: auth.user.id },
          recordId,
        ),
      {
        beforeReplay: () =>
          authorizeProjectReplay(prisma!, 'create', {
            familyId: auth.user.family_id,
            userId: auth.user.id,
          }, undefined, key),
      },
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    logRouteError('POST /api/projects', error, getRequestId(request))
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
