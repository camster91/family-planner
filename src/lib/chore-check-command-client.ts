/** Original-review transport only. No automatic retry, version renewal,
 * legacy endpoint fallback, durable queue or permission inferred from metadata.
 */
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";
import { requestOwnedJson } from "@/lib/owned-request-http";
import { CHORE_CHECK_COMMAND_PROTOCOL, CHORE_CHECK_OWNER_HEADER, choreCheckVersion, sameChoreCheckSnapshot,
  type ChoreCheckOwner, type ChoreCheckSnapshot, type ChoreCheckCommand } from "@/lib/chore-check-command-shared";
import type { CheckedChoreState } from "@/lib/chore-tick-client";
export type OwnedChoreCheckIntent = Readonly<{ body: string; choreId: string; owner: Readonly<ChoreCheckOwner>; expected: Readonly<ChoreCheckSnapshot> }>;
const validId = (value: unknown): value is string => typeof value === "string" && MEMBER_ID_PATTERN.test(value);
const sameOwner = (a: unknown, b: ChoreCheckOwner): boolean => {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  return x.userId === b.userId && x.familyId === b.familyId && x.role === b.role && x.generation === b.generation;
};
export function makeOwnedChoreCheckIntent(command: ChoreCheckCommand): OwnedChoreCheckIntent {
  const owner = command.owner;
  const version = choreCheckVersion({ responsibility_generation: command.expected.generation,
    responsibility_epoch: command.expected.materialEpoch, preparation_epoch: command.expected.completionEpoch });
  if (command.protocol !== CHORE_CHECK_COMMAND_PROTOCOL || !version || owner.role !== "parent"
      || !validId(command.choreId) || !validId(owner.userId) || !validId(owner.familyId)
      || !Number.isSafeInteger(owner.generation) || owner.generation < 0
      || !["approve", "reject"].includes(command.decision)
      || (command.verificationNotes !== undefined && (typeof command.verificationNotes !== "string" || command.verificationNotes.length > 500)))
    throw new Error("Chore check review unavailable");
  const originalOwner = { userId: owner.userId, familyId: owner.familyId, role: owner.role, generation: owner.generation };
  const frozen = { protocol: CHORE_CHECK_COMMAND_PROTOCOL, choreId: command.choreId, decision: command.decision,
    owner: originalOwner, expected: { ...version }, ...(command.verificationNotes !== undefined ? { verificationNotes: command.verificationNotes } : {}) };
  return Object.freeze({ body: JSON.stringify(frozen), choreId: command.choreId,
    owner: Object.freeze(originalOwner), expected: Object.freeze({ ...version }) });
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function state(value: unknown, id: string): CheckedChoreState | null {
  const row = record(value);
  if (!row || row.id !== id || !["pending", "in_progress", "completed", "verified", "overdue"].includes(String(row.status))
      || typeof row.photo_verified !== "boolean") return null;
  for (const field of ["completed_at", "verified_at"])
    if (row[field] !== null && (typeof row[field] !== "string" || !Number.isFinite(Date.parse(row[field] as string)))) return null;
  if (row.verified_notes !== null && typeof row.verified_notes !== "string") return null;
  return row as unknown as CheckedChoreState;
}
export type OwnedChoreCheckOutcome = { kind: "accepted"; chore: CheckedChoreState | null }
  | { kind: "held"; code: string } | { kind: "unknown" };
export async function sendOwnedChoreCheck(intent: OwnedChoreCheckIntent, signal?: AbortSignal): Promise<OwnedChoreCheckOutcome> {
  const reply = await requestOwnedJson("/api/chores/verify/owned", { method: "POST", signal,
    headers: { "Content-Type": "application/json" }, body: intent.body }, 64 * 1024);
  if (reply.kind !== "reply") return { kind: "unknown" };
  const body = record(reply.body);
  if (!reply.response.ok) return reply.response.status >= 500 ? { kind: "unknown" }
    : { kind: "held", code: typeof body?.code === "string" ? body.code : "CHORE_CHECK_REFUSED" };
  if (body?.success !== true || (body.choreId !== undefined && body.choreId !== intent.choreId)) return { kind: "unknown" };
  if (!Object.prototype.hasOwnProperty.call(body, "chore")) return { kind: "unknown" };
  const current = state(body.chore, intent.choreId);
  if (body.chore != null && !current) return { kind: "unknown" };
  // Accepted command is distinct from a current-resource proof when no row is present.
  return { kind: "accepted", chore: current };
}
export type OwnedChoreReviewRow = Record<string, unknown> & { id: string; family_id: string; title: string; status: string };
export type OwnedChoreRead = { kind: "current"; chore: OwnedChoreReviewRow | null; version: ChoreCheckSnapshot | null }
  | { kind: "held"; code: string } | { kind: "unknown" };
export async function readOwnedChoreCheck(owner: ChoreCheckOwner, choreId: string, signal?: AbortSignal): Promise<OwnedChoreRead> {
  if (!validId(choreId)) return { kind: "held", code: "CHORE_CHECK_INVALID" };
  const reply = await requestOwnedJson(`/api/chores/verify/owned?choreId=${choreId}`, { method: "GET", signal,
    headers: { [CHORE_CHECK_OWNER_HEADER]: JSON.stringify(owner) } }, 256 * 1024);
  if (reply.kind !== "reply") return { kind: "unknown" };
  const body = record(reply.body);
  if (!reply.response.ok) return { kind: "held", code: typeof body?.code === "string" ? body.code : "CHORE_CHECK_READ_UNAVAILABLE" };
  if (body?.protocol !== CHORE_CHECK_COMMAND_PROTOCOL || !sameOwner(body.owner, owner)) return { kind: "held", code: "CHORE_CHECK_OWNER_CHANGED" };
  if (body.chore === null) return body.version === null ? { kind: "current", chore: null, version: null } : { kind: "unknown" };
  const chore = record(body.chore);
  if (!chore || chore.id !== choreId || chore.family_id !== owner.familyId || typeof chore.title !== "string"
      || !["pending", "in_progress", "completed", "verified", "approved", "overdue"].includes(String(chore.status))) return { kind: "unknown" };
  const version = choreCheckVersion({ status: chore.status, responsibility_generation: chore.responsibility_generation,
    responsibility_epoch: chore.responsibility_epoch, preparation_epoch: chore.preparation_epoch });
  const claimed = record(body.version);
  const expected = claimed ? choreCheckVersion({ responsibility_generation: claimed.generation,
    responsibility_epoch: claimed.materialEpoch, preparation_epoch: claimed.completionEpoch }) : null;
  if ((version === null) !== (body.version === null) || (version && (!expected || !sameChoreCheckSnapshot(version, expected)))) return { kind: "unknown" };
  return { kind: "current", chore: chore as OwnedChoreReviewRow, version };
}
