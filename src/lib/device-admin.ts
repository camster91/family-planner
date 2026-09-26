/**
 * Parent-facing device list shapes (SHARED_DEVICE.md §7, §12.1). Explicit
 * selects only; never token hashes or elevation columns.
 */
import type { PrismaClient } from '@prisma/client'

export const DEVICE_LIST_SELECT = {
  id: true,
  label: true,
  platform: true,
  paired_at: true,
  last_seen_at: true,
  last_seen_app_version: true,
  revoked_at: true,
  revoke_reason: true,
} as const

/** Removed devices stay listed (greyed) for this long, then are hidden, not deleted. */
export const REMOVED_DEVICE_VISIBLE_MS = 30 * 24 * 60 * 60 * 1000

interface DeviceListRow {
  id: string
  label: string
  platform: string
  paired_at: Date
  last_seen_at: Date | null
  last_seen_app_version: string | null
  revoked_at: Date | null
  revoke_reason: string | null
}

export type DeviceListStatus = 'active' | 'removed' | 'expired'

export function serializeDevice(row: DeviceListRow, hasLiveSession: boolean) {
  const status: DeviceListStatus = row.revoked_at ? 'removed' : hasLiveSession ? 'active' : 'expired'
  return {
    id: row.id,
    label: row.label,
    platform: row.platform,
    pairedAt: row.paired_at.toISOString(),
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    appVersion: row.last_seen_app_version,
    status,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    revokeReason: row.revoke_reason,
  }
}

/** Devices (of `familyId`) that still hold a refreshable session generation. */
export async function devicesWithLiveSession(
  db: Pick<PrismaClient, 'deviceSession'>,
  familyId: string,
  deviceIds: string[],
  now: Date
): Promise<Set<string>> {
  if (deviceIds.length === 0) return new Set()
  const live = await db.deviceSession.findMany({
    where: {
      device_id: { in: deviceIds },
      family_id: familyId,
      revoked_at: null,
      rotated_at: null,
      refresh_expires_at: { gt: now },
    },
    select: { device_id: true },
  })
  return new Set(live.map((s) => s.device_id))
}
