import { IDEMPOTENCY_TTL_MS } from './idempotency-key'

/** Message ownership preconditions contain no token and never grant authority. */
export const MESSAGE_OWNER_PROTOCOL = 'herewoven.message-owner.v1'
export const MESSAGE_OWNER_HEADER = 'X-Herewoven-Message-Owner'
export type MessageWriteContext = { protocol: typeof MESSAGE_OWNER_PROTOCOL; userId: string; familyId: string; generation: number }
export function parseMessageWriteContext(value: unknown): MessageWriteContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== 4 || row.protocol !== MESSAGE_OWNER_PROTOCOL ||
    typeof row.userId !== 'string' || !row.userId.length || row.userId.length > 128 ||
    typeof row.familyId !== 'string' || !row.familyId.length || row.familyId.length > 128 ||
    typeof row.generation !== 'number' || !Number.isSafeInteger(row.generation) || row.generation < 0) return null
  return { protocol: MESSAGE_OWNER_PROTOCOL, userId: row.userId, familyId: row.familyId, generation: row.generation }
}
export function messageExpectedOwnerMatches(body: { expected_user_id?: unknown; expected_family_id?: unknown; expected_generation?: unknown }, actor: { userId: string; familyId: string; generation: number }) {
  if (body.expected_user_id === undefined && body.expected_family_id === undefined && body.expected_generation === undefined) return true
  return body.expected_user_id === actor.userId && body.expected_family_id === actor.familyId && body.expected_generation === actor.generation
}
/** Optional legacy-compatible upload precondition; malformed supplied proof refuses. */
export function messageOwnerHeaderMatches(raw: string | null, actor: { userId: string; familyId: string; generation: number }) {
  if (raw === null) return true
  if (raw.length > 1024) return false
  try {
    const owner = parseMessageWriteContext(JSON.parse(raw))
    return Boolean(owner && owner.userId === actor.userId && owner.familyId === actor.familyId && owner.generation === actor.generation)
  } catch { return false }
}

/** Mounted retries end well before receipt retention; timestamps are immutable request bytes. */
export const MESSAGE_SEND_RETRY_MS = Math.min(24 * 60 * 60 * 1000, Math.floor(IDEMPOTENCY_TTL_MS / 4))
export const MESSAGE_SEND_FUTURE_SKEW_MS = Math.min(5 * 60 * 1000, Math.floor(MESSAGE_SEND_RETRY_MS / 4))
export function messageSendWindowOpen(issuedAt: string, now = Date.now()): boolean {
  const issued = Date.parse(issuedAt)
  if (!Number.isFinite(issued) || !Number.isFinite(now) || new Date(issued).toISOString() !== issuedAt) return false
  const age = now - issued
  return age >= -MESSAGE_SEND_FUTURE_SKEW_MS && age < MESSAGE_SEND_RETRY_MS
}
export function messageSendWindowRefusal() {
  return { status: 409, body: { error: 'The original send time cannot be safely retried. Check the conversation and your device clock before starting a new message.', code: 'MESSAGE_SEND_WINDOW_CLOSED', retryable: false } }
}
