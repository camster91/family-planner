import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { updateUserSchema } from '@/lib/validations'
import { SAFE_USER_SELECT } from '@/lib/user-select'
import { isGamificationOn, omitUserGamification } from '@/lib/gamification-visibility'
import { refusePairedDevice } from '@/lib/device-route'
import { readIdempotencyKey } from '@/lib/idempotency'
import { deleteMemberAccount } from '@/lib/account-deletion'
import { checkFreshAuthorization, deletionError, runDeletion } from '@/lib/account-deletion-http'
import { ACCOUNT_DELETE_PHRASE } from '@/lib/account-deletion-shared'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

// GET - Get current user's full profile
export async function GET(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const user = await prisma!.user.findUnique({
      where: { id: payload.userId },
      select: SAFE_USER_SELECT,
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Points & streaks off for this family (#248): no XP/level/streak values.
    if (!(await isGamificationOn(user.family_id))) {
      return NextResponse.json({ user: omitUserGamification(user) })
    }

    return NextResponse.json({ user })
  } catch (error) {
    logRouteError('GET /api/users', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update user profile (no family_id changes allowed)
export async function PATCH(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = updateUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const updateData: Record<string, unknown> = {}
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name
    if (parsed.data.age !== undefined) {
      updateData.age = parsed.data.age ? parseInt(String(parsed.data.age)) : null
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const user = await prisma!.user.update({
      where: { id: payload.userId },
      data: updateData,
      select: SAFE_USER_SELECT,
    })

    if (!(await isGamificationOn(user.family_id))) {
      return NextResponse.json({ user: omitUserGamification(user) })
    }

    return NextResponse.json({ user })
  } catch (error) {
    logRouteError('PATCH /api/users', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
// DELETE - Delete the caller's own account (GDPR Article 17, right to erasure;
// docs/product/ACCOUNT_DELETION.md). Body: { password, confirmation: "DELETE" }.
//
// Fresh authorization: the current password and the typed word, every time.
// Household content the member created stays with the household (handed to
// the earliest other parent), their personal rows are deleted, and every
// session, token, PIN, calendar connection and idempotency record of theirs is
// revoked (src/lib/account-deletion.ts). The only parent of a household gets
// 409 LAST_PARENT: they delete the whole household with DELETE /api/family.
// A paired shared device gets 403 before person auth. Optional
// Idempotency-Key: a duplicate while the first runs is 409; once it finished
// the account is gone, so a retry is 401.
export async function DELETE(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    const idem = readIdempotencyKey(request)
    if (idem.error) return idem.error

    let body: { password?: unknown; confirmation?: unknown }
    try {
      body = (await request.json()) ?? {}
    } catch {
      return deletionError(400, 'PASSWORD_REQUIRED', 'Enter your password to continue.')
    }

    const refused = await checkFreshAuthorization(payload.userId, body, ACCOUNT_DELETE_PHRASE)
    if (refused) return refused

    return await runDeletion(
      {
        key: idem.key,
        userId: payload.userId,
        familyId: payload.family_id ?? null,
        action: 'account.delete',
        hashBody: { mode: 'account' },
      },
      async () => {
        const result = await deleteMemberAccount(payload.userId)
        return {
          status: 200,
          body: {
            success: true,
            mode: result.mode,
            filesRemoved: result.filesRemoved,
            filesNotRemoved: result.filesNotRemoved,
          },
        }
      }
    )
  } catch (error) {
    logRouteError('DELETE /api/users', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
