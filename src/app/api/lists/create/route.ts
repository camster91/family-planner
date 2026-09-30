import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { featureGate } from '@/lib/feature-gate-server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { createListSchema } from '@/lib/validations'
import { canCreateList } from '@/lib/role-capabilities'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    // O-11 (ADR-0007): lists are feature-gated server-side like every other domain.
    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return gate

    // D9 (#102): parents and teens may create a list. A child can add and tick
    // items on existing lists but not create one.
    if (!canCreateList(auth.user.role)) {
      return NextResponse.json({ error: 'Ask a parent to create a new list.' }, { status: 403 })
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = createListSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { name, type, description } = parsed.data

    const list = await prisma!.list.create({
      data: {
        family_id: auth.user.family_id,
        name,
        type,
        description: description ?? null,
        created_by: auth.user.id,
      },
    })

    return NextResponse.json({ success: true, list })
  } catch (error) {
    logRouteError('POST /api/lists/create', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
