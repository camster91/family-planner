import { parseProjectPaging } from "@/lib/project-paging"
import { readProjectOverview } from "@/lib/project-overview"
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
    const requestedStatus = searchParams.get('status')
    const status = requestedStatus && ['active', 'completed', 'archived'].includes(requestedStatus)
      ? requestedStatus : null
    const scope = { familyId: auth.user.family_id, status }
    const paging = parseProjectPaging(searchParams, scope)
    if (!paging.ok || (paging.paged && requestedStatus !== null && status === null)) {
      return NextResponse.json({ error: paging.ok ? 'Invalid project status filter' : paging.error }, { status: 400 })
    }
    const result = await readProjectOverview(prisma!, scope, paging)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
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
