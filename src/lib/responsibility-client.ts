/** Explicit foreground reads/sends only. Unknown outcomes never confirm consent. */
import { requestOwnedJson as request } from "@/lib/owned-request-http";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import {
  RESPONSIBILITY_PROTOCOL,
  responsibilityCommand,
  type ResponsibilityCommand,
  type ResponsibilityTarget,
} from "@/lib/responsibility";
import {
  responsibilityView,
  responsibilityReceipt,
  responsibilityReceiptMatches,
  type ResponsibilityView,
} from "@/lib/responsibility-http-contract";
import {
  RESPONSIBILITY_RECOVERY,
  RESPONSIBILITY_OWNER_HEADER,
  responsibilityRecoveryContext,
  responsibilityRecoveryEntry,
  responsibilityRecoveryReview,
  type ResponsibilityRecoveryContext,
  type ResponsibilityRecoveryEntry,
} from "@/lib/responsibility-recovery";
type Draft<T> = T extends unknown
  ? Omit<
      T,
      | "protocol"
      | "userId"
      | "familyId"
      | "target"
      | "sourceToken"
      | "expectedRevision"
      | "issuedAt"
    >
  : never;
export type ResponsibilityDraft = Draft<ResponsibilityCommand>;
export function makeResponsibilityIntent(
  draft: ResponsibilityDraft,
  view: ResponsibilityView,
  context: ResponsibilityRecoveryContext,
  now = new Date(),
  key = newIdempotencyKey(),
): ResponsibilityRecoveryEntry {
  if (
    view.owner.userId !== context.userId ||
    view.owner.familyId !== context.familyId ||
    view.role !== context.role
  )
    throw new Error("Responsibility owner changed");
  const command = responsibilityCommand.parse({
    ...draft,
    protocol: RESPONSIBILITY_PROTOCOL,
    userId: context.userId,
    familyId: context.familyId,
    target: view.target,
    sourceToken: view.sourceToken,
    expectedRevision: view.revision,
    issuedAt: now.toISOString(),
  });
  return responsibilityRecoveryEntry.parse({
    kind: "responsibility",
    key,
    body: JSON.stringify(command),
  });
}
export async function readResponsibilityContext() {
  const result = await request(
    "/api/coordination/responsibilities/recovery",
    {},
    16384,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Responsibility recovery unavailable");
  return responsibilityRecoveryContext.parse(result.body);
}
export async function readResponsibility(
  target: ResponsibilityTarget,
  context: ResponsibilityRecoveryContext,
  query = "",
) {
  const result = await request(
    `/api/coordination/responsibilities?${new URLSearchParams({ ...target, ...(query ? { q: query } : {}) })}`,
    {},
    65536,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Responsibility unavailable");
  const view = responsibilityView.parse(
    (result.body as { view?: unknown })?.view,
  );
  if (
    view.owner.userId !== context.userId ||
    view.owner.familyId !== context.familyId ||
    view.role !== context.role ||
    view.target.kind !== target.kind ||
    view.target.id !== target.id
  )
    throw new Error("Responsibility owner changed");
  return view;
}
export async function inspectResponsibility(
  entry: ResponsibilityRecoveryEntry,
  context: ResponsibilityRecoveryContext,
) {
  if (!context.owner) throw new Error("Responsibility owner changed");
  const result = await request(
    "/api/coordination/responsibilities/recovery",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [RESPONSIBILITY_OWNER_HEADER]: context.owner.scope,
      },
      body: JSON.stringify({ contract: RESPONSIBILITY_RECOVERY, entry }),
    },
    16384,
  );
  if (result.kind !== "reply" || !result.response.ok)
    throw new Error("Responsibility recovery unavailable");
  const value = responsibilityRecoveryReview.parse(result.body);
  if (
    value.ownerScope !== context.owner.scope ||
    value.entry.key !== entry.key ||
    value.entry.body !== entry.body
  )
    throw new Error("Responsibility owner changed");
  return value;
}
export async function sendResponsibility(
  entry: ResponsibilityRecoveryEntry,
  ownerScope: string,
) {
  responsibilityRecoveryEntry.parse(entry);
  const command = responsibilityCommand.parse(JSON.parse(entry.body));
  const result = await request(
    "/api/coordination/responsibilities",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": entry.key,
        [RESPONSIBILITY_OWNER_HEADER]: ownerScope,
      },
      body: entry.body,
    },
    16384,
  );
  if (result.kind !== "reply") return { kind: "unknown" as const };
  if (!result.response.ok)
    return {
      kind:
        result.response.status >= 500 || result.response.status === 409
          ? ("unknown" as const)
          : ("refused" as const),
    };
  return responsibilityReceiptMatches(result.body, command, entry.key)
    ? {
        kind: "confirmed" as const,
        receipt: responsibilityReceipt.parse(result.body),
      }
    : { kind: "unknown" as const };
}
