import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import {
  applyBoardSettingsPatch,
  boardSettingsSnapshot,
  lockBoardSettings,
  changedBoardSections,
  parseBoardSettingsPatch,
  readBoardSettings,
} from '@/lib/board-settings'
import { boardSettingsSummary, writeAuditLog } from '@/lib/household-audit'

export const dynamic = 'force-dynamic'

/**
 * Today board settings (#262): member colours and the opt-in weather place.
 * Parent only, own household only. Person sessions only: a paired tablet
 * cookie is not a person session, so it gets 401 like every other person
 * route (device route allowlist test). A tablet changes the same settings
 * through /api/device/elevated/board-settings under a parent's elevation
 * (#274); both doors share src/lib/board-settings.ts.
 *
 * GET  -> { weather: { available, enabled, place, unit }, members: [{ id, name, color, custom }],
 *           display: { idleMinutes, idleChoices, night: { start, end } | null, photoIds,
 *                      uploads: [{ id, url, createdAt }] },
 *           deviceWrites: { available, enabled } }
 * PATCH { weather?: { enabled?, place?, unit? }, memberColors?: { [memberId]: key | null },
 *         display?: { idleMinutes?, night?: { start, end } | null, photoIds? },
 *         deviceWrites?: { enabled } }
 *
 * Calm display (#271): `display.uploads` lists the household's own
 * displayable photo uploads (newest first) for the parent to choose from;
 * every `photoIds` entry must be one of them (a foreign and a missing id get
 * the same 400). Shared-tablet writes (#274): `deviceWrites.enabled` is the
 * per-household switch for SHARED_DEVICE.md §9.2, default off.
 */
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError
    return NextResponse.json(await readBoardSettings(prisma!, auth.user.family_id, 'person'))
  } catch (error) {
    console.error('Board settings read error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not load board settings' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError
    const familyId = auth.user.family_id

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = parseBoardSettingsPatch(body, 'person')
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    // The change and its household audit row (#285) commit together. A
    // refused patch has written nothing (every check runs before a write).
    // Only sections whose stored values actually changed are recorded, so a
    // no-op, a resubmitted value or a retry writes no history row.
    const refused = await prisma!.$transaction(async (tx) => {
      await lockBoardSettings(tx, familyId)
      const before = await boardSettingsSnapshot(tx, familyId)
      const result = await applyBoardSettingsPatch(tx, familyId, parsed.patch)
      if (result) return result
      const changed = changedBoardSections(before, await boardSettingsSnapshot(tx, familyId))
      if (changed.length === 0) return null
      await writeAuditLog(tx, {
        familyId,
        actorUserId: auth.user.id,
        actorKind: 'person',
        action: 'board_settings.changed',
        targetType: 'family',
        targetId: familyId,
        summary: boardSettingsSummary(changed),
      })
      return null
    })
    if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status })

    return NextResponse.json(await readBoardSettings(prisma!, familyId, 'person'))
  } catch (error) {
    console.error('Board settings save error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not save board settings' }, { status: 500 })
  }
}
