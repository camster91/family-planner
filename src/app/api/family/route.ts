import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest, authenticateWithFamily, attachSessionCookie, requireParent } from '@/lib/api-auth'
import { createFamilySchema, updateFamilySchema, deleteFamilySchema } from '@/lib/validations'
import { defaultFeatures } from '@/lib/features'
import { refusePairedDevice } from '@/lib/device-route'
import { readIdempotencyKey } from '@/lib/idempotency'
import { deleteHousehold } from '@/lib/account-deletion'
import { checkFreshAuthorization, runDeletion } from '@/lib/account-deletion-http'
import { lockUser } from '@/lib/household-lock'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

// POST - Create a new family
export async function POST(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = createFamilySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    // Check if user already has a family
    const existingUser = await prisma!.user.findUnique({
      where: { id: payload.userId },
      select: { family_id: true },
    })

    if (existingUser?.family_id) {
      return NextResponse.json({ error: 'You already belong to a family' }, { status: 400 })
    }

    // Under the caller's user lock (src/lib/household-lock.ts): an account
    // deletion holds it from before it reads family_id, so a household is never
    // created for an account that is being deleted (which would leave a Family
    // with no members). Re-checked here under the lock.
    const family = await prisma!.$transaction(async (tx) => {
      await lockUser(tx, payload.userId)
      const current = await tx.user.findUnique({ where: { id: payload.userId }, select: { family_id: true } })
      if (!current) return 'gone' as const
      if (current.family_id) return 'already' as const
      // Explicit new-household flags (#248): Points & streaks start OFF. A blob
      // without the `gamification` key would read as an existing household.
      const newFamily = await tx.family.create({
        data: { name: parsed.data.name, features: defaultFeatures() },
      })
      await tx.user.update({
        where: { id: payload.userId },
        data: { family_id: newFamily.id, role: 'parent' },
      })
      return newFamily
    })
    if (family === 'gone') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (family === 'already') {
      return NextResponse.json({ error: 'You already belong to a family' }, { status: 400 })
    }

    const user = await prisma!.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, family_id: true },
    })

    const response = NextResponse.json({ family })
    if (user) {
      await attachSessionCookie(response, {
        userId: user.id,
        email: user.email,
        role: user.role,
        family_id: user.family_id,
      })
    }
    return response
  } catch (error) {
    logRouteError('POST /api/family', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET - Get current user's family details
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const family = await prisma!.family.findUnique({
      where: { id: auth.user.family_id },
      select: {
        id: true,
        name: true,
        invite_code: true,
        subscription_tier: true,
        created_at: true,
        features: true,
        _count: {
          select: { members: true },
        },
      },
    })

    if (!family) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    return NextResponse.json({
      family: {
        id: family.id,
        name: family.name,
        invite_code: auth.user.role === 'parent' ? family.invite_code : null,
        subscription_tier: family.subscription_tier,
        created_at: family.created_at,
        member_count: family._count.members,
        features: family.features,
      },
      role: auth.user.role,
    })
  } catch (error) {
    logRouteError('GET /api/family', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update family settings (parents only, must be in that family)
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = updateFamilySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    if (parsed.data.familyId !== auth.user.family_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updateData: Record<string, unknown> = {}
    if (parsed.data.name) updateData.name = parsed.data.name
    if (parsed.data.subscription_tier) updateData.subscription_tier = parsed.data.subscription_tier

    const family = await prisma!.family.update({
      where: { id: parsed.data.familyId },
      data: updateData,
    })

    return NextResponse.json({ family })
  } catch (error) {
    logRouteError('PATCH /api/family', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete the whole household and every member account in it
// (docs/product/ACCOUNT_DELETION.md). Body: { familyId, password, confirmation }
// where `confirmation` is the household name typed out.
//
// Only the household's only parent may do this (another parent: 409
// OTHER_PARENTS_EXIST; each parent deletes their own account with
// DELETE /api/users and the last one deletes the household). Teens and
// children get 403. Fresh authorization every time: the current password and
// the typed household name. The deletion is an explicit ordered sequence
// (src/lib/account-deletion.ts `deleteHousehold`): sessions, shared devices,
// invitations and other tokens, calendar connections, uploaded files, stored
// idempotency records, then every household row and the member accounts.
// A paired shared device gets 403 before person auth. Optional
// Idempotency-Key: a duplicate while the first runs is 409; once it finished
// the caller no longer exists, so a retry is 401.
export async function DELETE(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = deleteFamilySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'familyId is required' }, { status: 400 })
    }

    if (parsed.data.familyId !== auth.user.family_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const idem = readIdempotencyKey(request)
    if (idem.error) return idem.error

    const family = await prisma!.family.findUnique({
      where: { id: auth.user.family_id },
      select: { name: true },
    })
    if (!family) return NextResponse.json({ error: 'Family not found' }, { status: 404 })

    const refused = await checkFreshAuthorization(auth.user.id, body, family.name)
    if (refused) return refused

    const familyId = auth.user.family_id
    return await runDeletion(
      {
        key: idem.key,
        userId: auth.user.id,
        familyId,
        action: 'household.delete',
        hashBody: { mode: 'household', familyId },
      },
      async () => {
        const result = await deleteHousehold(familyId, auth.user.id)
        return {
          status: 200,
          body: {
            success: true,
            mode: result.mode,
            membersRemoved: result.membersRemoved,
            filesRemoved: result.filesRemoved,
            filesNotRemoved: result.filesNotRemoved,
          },
        }
      }
    )
  } catch (error) {
    logRouteError('DELETE /api/family', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
