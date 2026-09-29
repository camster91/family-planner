import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { featureGate } from '@/lib/feature-gate-server'
import { authenticateWithFamily, requireFamilyMatch, requireParent } from '@/lib/api-auth'
import { deleteListSchema } from '@/lib/validations'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    // O-11 (ADR-0007): lists are feature-gated server-side like every other domain.
    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return gate

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')

    const where: Record<string, unknown> = { family_id: auth.user.family_id }
    if (type) {
      where.type = type
    }

    const lists = await prisma!.list.findMany({
      where,
      include: {
        _count: { select: { items: true } },
        creator: { select: { name: true } },
      },
      orderBy: { updated_at: 'desc' },
    })

    return NextResponse.json({ lists })
  } catch (error) {
    logRouteError('GET /api/lists', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a list (family-scoped, cascade deletes items)
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    // O-11 (ADR-0007): lists are feature-gated server-side like every other domain.
    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return gate

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = deleteListSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'listId is required' }, { status: 400 })
    }

    const list = await (prisma as any).list.findUnique({
      where: { id: parsed.data.listId },
      select: { family_id: true },
    })

    if (!list) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(list.family_id, auth.user.family_id)
    if (familyError) return familyError

    await (prisma as any).list.delete({ where: { id: parsed.data.listId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    logRouteError('DELETE /api/lists', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
