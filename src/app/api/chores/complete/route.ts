import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { completeChoreSchema } from '@/lib/validations'
import { resolveChorePhotoForWrite } from '@/lib/chore-photos'
import { COMPLETABLE_CHORE_SELECT, completeChore } from '@/lib/chore-complete'

export const dynamic = 'force-dynamic'

/**
 * POST /api/chores/complete. The write itself is `completeChore`
 * (src/lib/chore-complete.ts), shared with the paired tablet's
 * POST /api/device/chores/:id/complete (#274), so the rules cannot drift:
 * only an open chore completes, a repeat is a no-op, and only a parent's
 * verify awards XP.
 */
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = completeChoreSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { choreId, photoUrl } = parsed.data

    const chore = await prisma!.chore.findUnique({ where: { id: choreId }, select: COMPLETABLE_CHORE_SELECT })
    if (!chore) {
      return NextResponse.json({ error: 'Chore not found' }, { status: 404 })
    }

    const familyError = requireFamilyMatch(chore.family_id, auth.user.family_id)
    if (familyError) return familyError

    // D3 (#102): a completion photo must be an upload owned by the caller's
    // family. Checked before the transaction so a bad photo changes nothing.
    const photo = await resolveChorePhotoForWrite(auth.user.family_id, photoUrl, chore.photo_url)
    if (!photo.ok) {
      return NextResponse.json({ error: photo.error }, { status: 400 })
    }

    const completed = await completeChore(
      prisma!,
      chore,
      { id: auth.user.id, name: auth.user.name },
      { photoValue: photo.value }
    )

    if (!completed) {
      return NextResponse.json({ success: true, alreadyCompleted: true })
    }

    return NextResponse.json({
      success: true,
      choreId,
    })
  } catch (error) {
    console.error('Error completing chore:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
