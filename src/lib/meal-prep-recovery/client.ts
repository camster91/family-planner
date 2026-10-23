/** Explicit bounded foreground transport. No dispatch on mount or inspection. */
import { requestOwnedJson as request } from "../owned-request-http";
import { newIdempotencyKey } from "../idempotency-key";
import { hashBrowserIdempotentRequest } from "../idempotency-request-json";
import { sameQueueOwner } from "../queue-owner-contract";
import {
  PREP_RECOVERY,
  PREP_OWNER_HEADER,
  prepCommand,
  prepContext,
  prepEntry,
  prepAction,
  prepStatus,
  prepReceipt,
  prepReceiptMatches,
  prepMatchesContext,
  prepRecoveryReply,
  type PrepEntry,
  type PrepContext,
  type PrepCommand,
} from "./contract";
import {
  prepDraftPayload,
  prepDraftEntry,
  type PrepDraft,
} from "./draft-contract";
export class PrepOwnerChanged extends Error {
  constructor() {
    super("Bulk work owner changed");
  }
}
export async function readPrepContext() {
  const result = await request("/api/meals/bulk/recovery/context", {}, 16384);
  if (result.kind === "reply" && [401, 403].includes(result.response.status))
    throw new PrepOwnerChanged();
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Bulk recovery unavailable");
  return prepContext.parse(result.body);
}
function requireOwner(entry: PrepEntry, context: PrepContext) {
  prepEntry.parse(entry);
  if (!context.owner || !prepMatchesContext(entry, context))
    throw new PrepOwnerChanged();
}
export function makePrepIntent(
  input: PrepCommand["input"],
  context: PrepContext,
  key = newIdempotencyKey(),
  issuedAt = new Date().toISOString(),
): PrepEntry {
  if (!context.enabled || !context.owner)
    throw new Error("Bulk writing paused");
  const command = prepCommand.parse({
    protocol: PREP_RECOVERY,
    kind: "dishes" in input ? "create" : "action",
    input,
    role: context.role,
    generation: context.owner.generation,
    issuedAt,
  });
  const entry = prepEntry.parse({
    kind: "meal-prep",
    key,
    body: JSON.stringify(command),
  });
  requireOwner(entry, context);
  return entry;
}
export function makePrepDraft(
  draft: PrepDraft,
  context: PrepContext,
  key = newIdempotencyKey(),
) {
  if (!context.enabled || !context.owner)
    throw new Error("Bulk editing paused");
  const body = prepDraftPayload.parse({
    userId: context.userId,
    familyId: context.familyId,
    role: context.role,
    generation: context.owner.generation,
    draft,
  });
  return prepDraftEntry.parse({
    kind: "local-prep-draft",
    key,
    body: JSON.stringify(body),
  });
}
async function renewOwner(original: PrepContext) {
  const current = await readPrepContext();
  if (
    !original.owner ||
    !current.owner ||
    !sameQueueOwner(original.owner, current.owner) ||
    original.userId !== current.userId ||
    original.familyId !== current.familyId ||
    original.role !== current.role
  )
    throw new PrepOwnerChanged();
  return current;
}
export async function inspectPrepIntent(
  entry: PrepEntry,
  context: PrepContext,
) {
  requireOwner(entry, context);
  const result = await request(
    "/api/meals/bulk/recovery/inspect",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [PREP_OWNER_HEADER]: context.owner!.scope,
      },
      body: JSON.stringify({ contract: PREP_RECOVERY, entry }),
    },
    262144,
  );
  if (result.kind === "reply" && [401, 403].includes(result.response.status))
    throw new PrepOwnerChanged();
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Bulk receipt unavailable");
  const reply = prepRecoveryReply.parse(result.body);
  const command = prepCommand.parse(JSON.parse(entry.body));
  const hash = await hashBrowserIdempotentRequest(prepAction(command), command);
  if (
    !hash ||
    reply.ownerScope !== context.owner!.scope ||
    reply.entry.key !== entry.key ||
    reply.entry.body !== entry.body ||
    reply.requestHash !== hash
  )
    throw new Error("Bulk receipt binding changed");
  const current = await renewOwner(context);
  return {
    ...reply,
    retryEligible:
      reply.canRetry &&
      current.enabled &&
      reply.retryUntil !== null &&
      Date.now() < Date.parse(reply.retryUntil),
  };
}
export async function sendPrepIntent(entry: PrepEntry, context: PrepContext) {
  requireOwner(entry, context);
  if (!context.enabled) throw new Error("Bulk writing paused");
  const command = prepCommand.parse(JSON.parse(entry.body));
  const result = await request(
    "/api/meals/bulk/recovery/apply",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [PREP_OWNER_HEADER]: context.owner!.scope,
        "Idempotency-Key": entry.key,
      },
      body: JSON.stringify({ contract: PREP_RECOVERY, entry }),
    },
    16384,
  );
  if (
    result.kind !== "reply" ||
    result.response.status !== prepStatus(command) ||
    !prepReceiptMatches(result.body, command)
  )
    return { kind: "unknown" as const };
  return {
    kind: "confirmed" as const,
    receipt: prepReceipt.parse(result.body),
  };
}
