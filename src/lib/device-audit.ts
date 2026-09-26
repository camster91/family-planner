/**
 * Shared-device audit trail (SHARED_DEVICE.md §10).
 *
 * Fixed vocabulary, fixed metadata keys per type. Never names, free text,
 * codes, PINs, tokens, IPs or user agents. Writes are best effort: an audit
 * failure is logged and never turns a security action (revocation, reuse
 * detection, lockout) into an error for the caller.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { log } from '@/lib/logger'

type PairingCancelReason = 'parent' | 'digits_mismatch' | 'superseded' | 'device_limit'
export type RevokeReason = 'parent' | 'lost' | 'replaced' | 'token_reuse'
export type ElevationEndReason = 'exit' | 'idle' | 'max' | 'revoked' | 'credential_changed'
export type ElevatedActionName = 'rename_device' | 'revoke_device'

export type DeviceAuditEntry =
  | { type: 'device.pairing_created'; metadata: { pairingId: string } }
  | { type: 'device.pairing_claimed'; metadata: { pairingId: string; platform: string; appVersion: string | null } }
  | { type: 'device.pairing_confirmed'; metadata: { pairingId: string } }
  | { type: 'device.pairing_cancelled'; metadata: { pairingId: string; reason: PairingCancelReason } }
  | { type: 'device.paired'; metadata: { pairingId: string; platform: string } }
  | { type: 'device.renamed'; metadata: Record<string, never> }
  | { type: 'device.revoked'; metadata: { reason: RevokeReason } }
  | { type: 'device.token_reuse_detected'; metadata: { sessionId: string } }
  | { type: 'device.elevation_started'; metadata: { method: 'pin' | 'password' } }
  | { type: 'device.elevation_ended'; metadata: { reason: ElevationEndReason } }
  | { type: 'device.elevation_locked'; metadata: { scope: 'device' | 'account' } }
  | {
      type: 'device.elevated_action'
      metadata: { action: ElevatedActionName; targetType: 'device'; targetId: string }
    }
  | { type: 'parent_pin.set'; metadata: Record<string, never> }
  | { type: 'parent_pin.removed'; metadata: Record<string, never> }
  | { type: 'parent_pin.cleared_by_reset'; metadata: Record<string, never> }

export type DeviceAuditType = DeviceAuditEntry['type']

type AuditDb = Pick<PrismaClient, 'deviceAuditEvent'>

export async function writeDeviceAudit(
  db: AuditDb,
  entry: DeviceAuditEntry & { familyId: string; deviceId?: string | null; actorUserId?: string | null }
): Promise<void> {
  try {
    await db.deviceAuditEvent.create({
      data: {
        family_id: entry.familyId,
        device_id: entry.deviceId ?? null,
        actor_user_id: entry.actorUserId ?? null,
        type: entry.type,
        metadata: entry.metadata as Prisma.InputJsonValue,
      },
      select: { id: true },
    })
  } catch (error) {
    log.error('device.audit_write_failed', error instanceof Error ? error : new Error(String(error)), {
      type: entry.type,
    })
  }
}

/** Audit retention (O-12): rows older than this are pruned when a parent opens the device list. */
export const AUDIT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000
