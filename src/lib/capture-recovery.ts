import { hashBrowserIdempotentRequest } from '@/lib/idempotency-request-json'
/**
 * Small, privacy-scoped recovery envelopes for confirmed AI capture writes.
 *
 * Only the normalized write body, its replay key/hash and a display title are
 * retained. Provider prompts, source photos, model output and credentials are
 * deliberately excluded. The server receipt remains authoritative.
 */

import {
  CAPTURE_RECOVERY_ACTIVE_STORAGE_KEY,
  CAPTURE_RECOVERY_STORAGE_PREFIX,
  captureRecoveryStorageKey,
  type RecoveryStorage,
} from './capture-recovery-storage'

export {
  CAPTURE_RECOVERY_ACTIVE_STORAGE_KEY,
  CAPTURE_RECOVERY_STORAGE_PREFIX,
  captureRecoveryStorageKey,
  clearCaptureRecoveryStorage,
  type RecoveryStorage,
} from './capture-recovery-storage'

export const CAPTURE_RECOVERY_RETENTION_MS = 6 * 24 * 60 * 60 * 1000
export const CAPTURE_RECOVERY_MAX_OPERATIONS = 20

export type CaptureRecoveryAction = 'event.create' | 'capture.grocery.add'
export type CaptureRecoveryKind = 'event' | 'listitem'

export interface CaptureRecoveryEnvelope {
  version: 1
  key: string
  action: CaptureRecoveryAction
  requestHash: string
  body: string
  title: string
  kind: CaptureRecoveryKind
  createdAt: number
  photo: boolean
}

export interface CaptureRecoveryLoadResult {
  rows: CaptureRecoveryEnvelope[]
  /** False means the browser store could not be read or rewritten safely. */
  storageAvailable: boolean
}

function isAction(value: unknown): value is CaptureRecoveryAction {
  return value === 'event.create' || value === 'capture.grocery.add'
}

function isEnvelope(value: unknown): value is CaptureRecoveryEnvelope {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<CaptureRecoveryEnvelope>
  return (
    row.version === 1 &&
    typeof row.key === 'string' &&
    row.key.length >= 16 &&
    row.key.length <= 128 &&
    isAction(row.action) &&
    typeof row.requestHash === 'string' &&
    (row.requestHash === '' || /^[a-f0-9]{64}$/.test(row.requestHash)) &&
    typeof row.body === 'string' &&
    row.body.length > 0 &&
    row.body.length <= 12_000 &&
    typeof row.title === 'string' &&
    row.title.length <= 200 &&
    (row.kind === 'event' || row.kind === 'listitem') &&
    Number.isFinite(row.createdAt) &&
    typeof row.photo === 'boolean'
  )
}

function safeStorage(storage?: RecoveryStorage | null): RecoveryStorage | null {
  if (storage) return storage
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Mark the current account namespace and remove a prior account's envelopes. */
export function activateCaptureRecoveryStorage(
  storage: RecoveryStorage | null | undefined,
  userId: string,
  familyId: string,
): string | null {
  const target = safeStorage(storage)
  if (!target || !userId || !familyId) return null
  const key = captureRecoveryStorageKey(userId, familyId)
  try {
    const previous = target.getItem(CAPTURE_RECOVERY_ACTIVE_STORAGE_KEY)
    if (
      previous &&
      previous !== key &&
      previous.startsWith(CAPTURE_RECOVERY_STORAGE_PREFIX)
    )
      target.removeItem(previous)
    target.setItem(CAPTURE_RECOVERY_ACTIVE_STORAGE_KEY, key)
    return key
  } catch {
    return null
  }
}

export function loadCaptureRecoveryState(
  storage: RecoveryStorage | null | undefined,
  userId: string,
  familyId: string,
  now = Date.now(),
): CaptureRecoveryLoadResult {
  const target = safeStorage(storage)
  if (!target) return { rows: [], storageAvailable: false }
  const key = captureRecoveryStorageKey(userId, familyId)
  let raw: string | null
  try {
    raw = target.getItem(key)
    if (!raw) return { rows: [], storageAvailable: true }
  } catch {
    return { rows: [], storageAvailable: false }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    try {
      target.removeItem(key)
      return { rows: [], storageAvailable: true }
    } catch {
      return { rows: [], storageAvailable: false }
    }
  }
  if (!Array.isArray(parsed)) {
    try {
      target.removeItem(key)
      return { rows: [], storageAvailable: true }
    } catch {
      return { rows: [], storageAvailable: false }
    }
  }

  const rows = parsed
    .filter(isEnvelope)
    .filter((row) => now - row.createdAt < CAPTURE_RECOVERY_RETENTION_MS)
    .slice(0, CAPTURE_RECOVERY_MAX_OPERATIONS)
  try {
    target.setItem(key, JSON.stringify(rows))
    return { rows, storageAvailable: true }
  } catch {
    try {
      target.removeItem(key)
    } catch {
      // Storage is optional; a corrupt or unavailable browser store should not
      // block an ordinary mounted capture.
    }
    return { rows: [], storageAvailable: false }
  }
}

export function loadCaptureRecovery(
  storage: RecoveryStorage | null | undefined,
  userId: string,
  familyId: string,
  now = Date.now(),
): CaptureRecoveryEnvelope[] {
  return loadCaptureRecoveryState(storage, userId, familyId, now).rows
}

export function saveCaptureRecovery(
  storage: RecoveryStorage | null | undefined,
  userId: string,
  familyId: string,
  rows: CaptureRecoveryEnvelope[],
): boolean {
  const target = safeStorage(storage)
  if (!target) return false
  try {
    target.setItem(
      captureRecoveryStorageKey(userId, familyId),
      JSON.stringify(rows.filter(isEnvelope).slice(0, CAPTURE_RECOVERY_MAX_OPERATIONS)),
    )
    return true
  } catch {
    // A confirmed mutation must not proceed when its recovery envelope could
    // not be durably retained. The caller decides how to preserve the draft
    // and explain the blocked confirmation.
    return false
  }
}

/** Uses the same canonical serialization as server receipts. */
export async function hashCaptureRequest(action: CaptureRecoveryAction, body: unknown): Promise<string> {
  return hashBrowserIdempotentRequest(action, body)
}
