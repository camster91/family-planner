/**
 * Small, privacy-scoped recovery envelopes for confirmed AI capture writes.
 *
 * Only the normalized write body, its replay key/hash and a display title are
 * retained. Provider prompts, source photos, model output and credentials are
 * deliberately excluded. The server receipt remains authoritative.
 */

export const CAPTURE_RECOVERY_RETENTION_MS = 6 * 24 * 60 * 60 * 1000
export const CAPTURE_RECOVERY_MAX_OPERATIONS = 20
const STORAGE_PREFIX = 'family-planner:capture-recovery:v1:'
const ACTIVE_STORAGE_KEY = `${STORAGE_PREFIX}active`

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

export interface RecoveryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
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

export function captureRecoveryStorageKey(userId: string, familyId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(familyId)}`
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
    const previous = target.getItem(ACTIVE_STORAGE_KEY)
    if (previous && previous !== key && previous.startsWith(STORAGE_PREFIX)) target.removeItem(previous)
    target.setItem(ACTIVE_STORAGE_KEY, key)
    return key
  } catch {
    return null
  }
}

/**
 * Drop the active capture-recovery namespace when a session ends. Capture
 * envelopes contain normalized household content, so logout must remove both
 * the active-account marker and its namespace rather than waiting for the
 * next account to mount CaptureBox.
 */
export function clearCaptureRecoveryStorage(
  storage: RecoveryStorage | null | undefined,
  userId?: string,
  familyId?: string,
): void {
  const target = safeStorage(storage)
  if (!target) return
  try {
    const active = target.getItem(ACTIVE_STORAGE_KEY)
    const keys = new Set<string>()
    if (userId && familyId) keys.add(captureRecoveryStorageKey(userId, familyId))
    if (active && active.startsWith(STORAGE_PREFIX) && active !== ACTIVE_STORAGE_KEY) keys.add(active)
    for (const key of keys) target.removeItem(key)
    target.removeItem(ACTIVE_STORAGE_KEY)
  } catch {
    // Storage is optional; logout should continue even if private mode denies removal.
  }
}

export function loadCaptureRecovery(
  storage: RecoveryStorage | null | undefined,
  userId: string,
  familyId: string,
  now = Date.now(),
): CaptureRecoveryEnvelope[] {
  const target = safeStorage(storage)
  if (!target) return []
  const key = captureRecoveryStorageKey(userId, familyId)
  try {
    const raw = target.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Invalid recovery envelope')
    const rows = parsed
      .filter(isEnvelope)
      .filter((row) => now - row.createdAt < CAPTURE_RECOVERY_RETENTION_MS)
      .slice(0, CAPTURE_RECOVERY_MAX_OPERATIONS)
    target.setItem(key, JSON.stringify(rows))
    return rows
  } catch {
    try {
      target.removeItem(key)
    } catch {
      // Storage is optional; a corrupt or unavailable browser store should not
      // block an ordinary mounted capture.
    }
    return []
  }
}

export function saveCaptureRecovery(
  storage: RecoveryStorage | null | undefined,
  userId: string,
  familyId: string,
  rows: CaptureRecoveryEnvelope[],
): void {
  const target = safeStorage(storage)
  if (!target) return
  try {
    target.setItem(
      captureRecoveryStorageKey(userId, familyId),
      JSON.stringify(rows.filter(isEnvelope).slice(0, CAPTURE_RECOVERY_MAX_OPERATIONS)),
    )
  } catch {
    // Quota/private-mode failures degrade to mounted-only recovery.
  }
}

/** Key-order-independent JSON matching the server idempotency hash contract. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`
}

export async function hashCaptureRequest(action: CaptureRecoveryAction, body: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return ''
  const bytes = new TextEncoder().encode(`${action}\n${canonical(body)}`)
  const digest = await subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
