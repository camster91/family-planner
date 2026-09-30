import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeDeviceAudit } from '@/lib/device-audit'
import { deviceError, deviceInternalError, deviceJson, killSwitch, readJson } from '@/lib/device-http'
import { authenticateDevice, requireElevation } from '@/lib/device-route'
import {
  applyBoardSettingsPatch,
  boardSettingsSnapshot,
  lockBoardSettings,
  changedBoardSections,
  parseBoardSettingsPatch,
  readBoardSettings,
} from '@/lib/board-settings'
import { boardSettingsSummary, writeAuditLog } from '@/lib/household-audit'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

/**
 * Board setup on the tablet itself (#274, SHARED_DEVICE.md §6.4): a parent
 * elevated with their PIN reads and changes the same settings as
 * /api/family/board-settings, through the same src/lib/board-settings.ts.
 *
 * GET   -> the device audience of the settings: weather (place label only, no
 *          coordinates), member names and colours, idle minutes and night
 *          hours, the tablet-writes switch. Never photos (O-15).
 * PATCH { weather?, memberColors?, display?: { idleMinutes?, night? }, deviceWrites? }
 *          -> the same body as GET. `display.photoIds` is refused (400).
 *
 * Both need `X-Device-Elevation` (403 `ELEVATION_REQUIRED` / `ELEVATION_EXPIRED`
 * otherwise). Every change is audited as `device.elevated_action` /
 * `update_board_settings` with the section names it touched, never values,
 * and in the household audit history (#285) in the same transaction.
 */
export async function GET(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const auth = await authenticateDevice(request)
    if (!auth.ok) return auth.response
    const elevated = await requireElevation(request, auth)
    if (!elevated.ok) return elevated.response
    return deviceJson(await readBoardSettings(prisma!, elevated.actor.familyId, 'device'))
  } catch (error) {
    return deviceInternalError('device.board_settings_read', error, getRequestId(request))
  }
}

export async function PATCH(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const auth = await authenticateDevice(request)
    if (!auth.ok) return auth.response
    const elevated = await requireElevation(request, auth)
    if (!elevated.ok) return elevated.response
    const { actor } = elevated

    const parsed = parseBoardSettingsPatch(await readJson(request), 'device')
    if (!parsed.ok) return deviceError(400, 'VALIDATION_ERROR', { message: parsed.error })

    // The change and its household audit row (#285, actor: the elevated
    // parent on the tablet) commit together.
    // Only sections whose stored values actually changed are recorded.
    const refused = await prisma!.$transaction(async (tx) => {
      await lockBoardSettings(tx, actor.familyId)
      const before = await boardSettingsSnapshot(tx, actor.familyId)
      const result = await applyBoardSettingsPatch(tx, actor.familyId, parsed.patch)
      if (result) return result
      const changed = changedBoardSections(before, await boardSettingsSnapshot(tx, actor.familyId))
      if (changed.length === 0) return null
      await writeAuditLog(tx, {
        familyId: actor.familyId,
        actorUserId: actor.parentId,
        actorKind: 'device',
        action: 'board_settings.changed',
        targetType: 'family',
        targetId: actor.familyId,
        summary: boardSettingsSummary(changed),
      })
      return null
    })
    if (refused) return deviceError(refused.status, 'VALIDATION_ERROR', { message: refused.error })

    if (parsed.sections.length > 0) {
      await writeDeviceAudit(prisma!, {
        familyId: actor.familyId,
        deviceId: actor.deviceId,
        actorUserId: actor.parentId,
        type: 'device.elevated_action',
        metadata: {
          action: 'update_board_settings',
          targetType: 'family',
          targetId: actor.familyId,
          sections: parsed.sections,
        },
      })
    }
    return deviceJson(await readBoardSettings(prisma!, actor.familyId, 'device'))
  } catch (error) {
    return deviceInternalError('device.board_settings_save', error, getRequestId(request))
  }
}
