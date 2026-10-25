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
