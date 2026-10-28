/** Server-only, short-lived exact-target review. No content in signed tokens. */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getJwtSecret } from "./auth";
import { canonicalRequestJson } from "./idempotency-request-json";
import { memberIdentityIdSchema as id } from "./member-subject-contract";
import {
  AssistantSourceRefused,
  isAssistantConfirmationEnabled,
  type AssistantProofActor,
} from "./assistant-source-proof";
import {
  assistantDeleteKind,
  ASSISTANT_TARGET_PROOF_HEADER,
} from "./assistant-reference-contract";

export type DeleteKind = z.infer<typeof assistantDeleteKind>;
type Row = Record<string, unknown>;
type JsonRow = { row: Row };
const ownerSchema = z
  .object({
    userId: id,
    familyId: id,
    role: z.enum(["parent", "teen"]),
    generation: z.number().int().min(0).max(2147483647),
  })
  .strict();
const proofSchema = z
  .object({
    v: z.literal(1),
    owner: ownerSchema,
    kind: assistantDeleteKind,
    id,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const digest = (domain: string, input: unknown, key = getJwtSecret()) =>
  createHmac("sha256", key)
    .update(canonicalRequestJson([domain, input]))
    .digest("hex");
export type DeleteSnapshot = { row: Row; children: Row[][] };
const cap = 500;
/** Caller holds actor -> household locks. Parent row locks also block FK child
 * inserts. Existing child updates/deletes are locked before the final read. */
export async function readDeleteSnapshot(
  tx: Prisma.TransactionClient,
  familyId: string,
  kind: DeleteKind,
  targetId: string,
): Promise<DeleteSnapshot | null> {
  let rows: JsonRow[], children: JsonRow[][];
  if (kind === "event_delete") {
    rows = await tx.$queryRaw<
      JsonRow[]
    >`SELECT to_jsonb(t) AS row FROM "Event" t WHERE t."id"=${targetId} AND t."family_id"=${familyId} FOR UPDATE`;
    if (!rows.length) return null;
    const plans = await tx.$queryRaw<
      JsonRow[]
    >`SELECT to_jsonb(t) AS row FROM "EventPreparation" t WHERE t."event_id"=${targetId} AND t."family_id"=${familyId} ORDER BY t."id" LIMIT 501 FOR UPDATE`;
    const steps = await tx.$queryRaw<
      JsonRow[]
    >`SELECT to_jsonb(t) AS row FROM "EventPreparationStep" t JOIN "EventPreparation" p ON p."id"=t."preparation_id" AND p."family_id"=t."family_id" WHERE p."event_id"=${targetId} AND t."family_id"=${familyId} ORDER BY t."id" LIMIT 501 FOR UPDATE OF t`;
    const links = await tx.$queryRaw<
      JsonRow[]
    >`SELECT to_jsonb(t) AS row FROM "CalendarEventLink" t WHERE t."event_id"=${targetId} AND t."family_id"=${familyId} ORDER BY t."id" LIMIT 501 FOR UPDATE`;
    const foreign = await tx.$queryRaw<
      Array<{ found: number }>
    >`SELECT 1 AS found FROM "CalendarEventLink" WHERE "event_id"=${targetId} AND "family_id"<>${familyId} LIMIT 1`;
    if (foreign.length) throw new AssistantSourceRefused();
    children = [plans, steps, links];
  } else if (kind === "chore_delete") {
    rows = await tx.$queryRaw<
      JsonRow[]
    >`SELECT to_jsonb(t) AS row FROM "Chore" t WHERE t."id"=${targetId} AND t."family_id"=${familyId} FOR UPDATE`;
    if (!rows.length) return null;
    children = [
      await tx.$queryRaw<
        JsonRow[]
      >`SELECT to_jsonb(t) AS row FROM "ChoreAssignment" t WHERE t."chore_id"=${targetId} AND t."family_id"=${familyId} ORDER BY t."id" LIMIT 501 FOR UPDATE`,
      await tx.$queryRaw<
        JsonRow[]
      >`SELECT to_jsonb(t) AS row FROM "EventPreparationStep" t WHERE t."chore_id"=${targetId} AND t."family_id"=${familyId} ORDER BY t."id" LIMIT 501 FOR UPDATE`,
      await tx.$queryRaw<
        JsonRow[]
      >`SELECT to_jsonb(t) AS row FROM "ResponsibilityState" t WHERE t."chore_id"=${targetId} AND t."family_id"=${familyId} ORDER BY t."id" LIMIT 501 FOR UPDATE`,
    ];
    const foreign = await tx.$queryRaw<
      Array<{ found: number }>
    >`SELECT 1 AS found FROM "ChoreAssignment" WHERE "chore_id"=${targetId} AND "family_id"<>${familyId} LIMIT 1`;
    if (foreign.length || rows[0].row.member_subject_erased === true)
      throw new AssistantSourceRefused();
  } else {
    rows = await tx.$queryRaw<
      JsonRow[]
    >`SELECT to_jsonb(t) AS row FROM "List" t WHERE t."id"=${targetId} AND t."family_id"=${familyId} FOR UPDATE`;
    if (!rows.length) return null;
    children = [
      await tx.$queryRaw<
        JsonRow[]
      >`SELECT to_jsonb(t) AS row FROM "ListItem" t WHERE t."list_id"=${targetId} ORDER BY t."id" LIMIT 501 FOR UPDATE`,
      await tx.$queryRaw<
        JsonRow[]
      >`SELECT to_jsonb(t) AS row FROM "GroceryShoppingSession" t WHERE t."list_id"=${targetId} AND t."family_id"=${familyId} ORDER BY t."id" LIMIT 501 FOR UPDATE`,
    ];
    const foreign = await tx.$queryRaw<
      Array<{ found: number }>
    >`SELECT 1 AS found FROM "GroceryShoppingSession" WHERE "list_id"=${targetId} AND "family_id"<>${familyId} LIMIT 1`;
    if (foreign.length) throw new AssistantSourceRefused();
  }
  if (rows.length !== 1 || children.some((set) => set.length > cap))
    throw new AssistantSourceRefused();
  const snapshot = {
    row: rows[0].row,
    children: children.map((set) => set.map((record) => record.row)),
  };
  if (Buffer.byteLength(canonicalRequestJson(snapshot), "utf8") > 1024 * 1024)
    throw new AssistantSourceRefused();
  return snapshot;
}

export function issueDeleteTargetProof(
  actor: AssistantProofActor,
  kind: DeleteKind,
  targetId: string,
  snapshot: DeleteSnapshot,
  now = Date.now(),
  key = getJwtSecret(),
) {
  const payload = proofSchema.parse({
    v: 1,
    owner: actor,
    kind,
    id: targetId,
    issuedAt: now,
    expiresAt: now + 60000,
    fingerprint: digest("assistant-delete-snapshot.v1", snapshot, key),
  });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `adt1.${encoded}.${digest("assistant-delete-proof.v1", encoded, key)}`;
}
/** Expiry belongs to new-effect verification; completed receipts may replay. */
export function readDeleteTargetProof(
  token: string,
  actor: AssistantProofActor,
  kind: DeleteKind,
  targetId: string,
  key = getJwtSecret(),
) {
  try {
    if (token.length > 4096) throw new Error();
    const parts = /^adt1\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
    if (
      !parts ||
      !timingSafeEqual(
        Buffer.from(parts[2], "hex"),
        Buffer.from(digest("assistant-delete-proof.v1", parts[1], key), "hex"),
      )
    )
      throw new Error();
    const bytes = Buffer.from(parts[1], "base64url");
    if (bytes.toString("base64url") !== parts[1]) throw new Error();
    const payload = proofSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (
      canonicalRequestJson(payload.owner) !== canonicalRequestJson(actor) ||
      payload.kind !== kind ||
      payload.id !== targetId
    )
      throw new Error();
    return payload;
  } catch {
    throw new AssistantSourceRefused();
  }
}
/** Shared keyed fingerprint check; a native repository owns atomic reads. */
export function deleteTargetSnapshotCurrent(
  payload: ReturnType<typeof readDeleteTargetProof>, snapshot: DeleteSnapshot, now = Date.now(),
) {
  return isAssistantConfirmationEnabled() && now >= payload.issuedAt && now < payload.expiresAt &&
    payload.expiresAt - payload.issuedAt === 60000 &&
    digest("assistant-delete-snapshot.v1", snapshot) === payload.fingerprint;
}
export type DeleteTargetGuard = {
  d1?: { token: string; actor: AssistantProofActor; kind: DeleteKind; targetId: string };
  verify: (tx: Prisma.TransactionClient) => Promise<void>;
  assertCurrent: () => void;
};
export function assistantDeleteTargetGuard(
  request: { headers: Headers },
  actor: AssistantProofActor,
  kind: DeleteKind,
  targetId: string,
  required: boolean,
): DeleteTargetGuard | undefined {
  const token = request.headers.get(ASSISTANT_TARGET_PROOF_HEADER);
  if (!token) {
    if (required) throw new AssistantSourceRefused();
    return undefined;
  }
  const payload = readDeleteTargetProof(token, actor, kind, targetId);
  const assertCurrent = () => {
    if (
      !isAssistantConfirmationEnabled() ||
      Date.now() < payload.issuedAt ||
      Date.now() >= payload.expiresAt ||
      payload.expiresAt - payload.issuedAt !== 60000
    )
      throw new AssistantSourceRefused();
  };
  return {
    d1: { token, actor, kind, targetId },
    assertCurrent,
    async verify(tx) {
      try {
        if (
          !isAssistantConfirmationEnabled() ||
          Date.now() < payload.issuedAt ||
          Date.now() >= payload.expiresAt ||
          payload.expiresAt - payload.issuedAt !== 60000
        )
          throw new AssistantSourceRefused();
        const snapshot = await readDeleteSnapshot(
          tx,
          actor.familyId,
          kind,
          targetId,
        );
        if (
          !snapshot ||
          digest("assistant-delete-snapshot.v1", snapshot) !==
            payload.fingerprint ||
          Date.now() >= payload.expiresAt ||
          !isAssistantConfirmationEnabled()
        )
          throw new AssistantSourceRefused();
      } catch {
        throw new AssistantSourceRefused();
      }
    },
  };
}
