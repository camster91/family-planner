/** Server-only expand/rollback compatibility. No generated overlay is required. */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  RESPONSIBILITY_PROTOCOL,
  ResponsibilityError,
  responsibilityTarget,
  type ResponsibilityTarget,
} from "@/lib/responsibility";
type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;
/** Existing full-household deletion has already authorized/locked the family.
 * Metadata goes before its target/identity rows, including during rollback and
 * with an older generated client. No source columns or readiness flag needed. */
export async function clearHouseholdResponsibilityInTx(
  tx: Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">,
  familyId: string,
) {
  const rows = await tx.$queryRaw<
    Array<{ present: boolean }>
  >`SELECT to_regclass('public."ResponsibilityState"') IS NOT NULL AS present`;
  if (rows[0]?.present !== true) return;
  await tx.$executeRaw`DELETE FROM "ResponsibilityState" WHERE "family_id" = ${familyId}`;
}
export async function responsibilityStorageAvailable(
  tx: Reader,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ ready: boolean }>>`
    SELECT to_regclass('public."ResponsibilityState"') IS NOT NULL AND
      (SELECT COUNT(*) = 6 FROM pg_attribute WHERE NOT attisdropped
       AND attrelid IN (to_regclass('public."Chore"'), to_regclass('public."Pickup"'), to_regclass('public."Handoff"'))
       AND attname IN ('responsibility_generation', 'responsibility_epoch')) AS ready`;
  return rows[0]?.ready === true;
}
export type ResponsibilitySourceEpoch = {
  generation: string;
  epoch: number;
  recurrence_id?: string | null;
  root_generation?: string | null;
  root_epoch?: number | null;
};
const validGeneration = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const validEpoch = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= 0 &&
  (value as number) < 2147483647;
/** Epoch + immutable per-insertion nonce closes changed-away/back and recreated
 * target ABA. A chore also binds its current root epoch. No content enters hash. */
export function responsibilitySourceToken(
  target: ResponsibilityTarget,
  familyId: string,
  source: ResponsibilitySourceEpoch,
): string {
  if (!validGeneration(source.generation) || !validEpoch(source.epoch))
    throw new ResponsibilityError("UNAVAILABLE");
  const hasRoot = target.kind === "chore" && source.recurrence_id != null;
  if (
    hasRoot &&
    (!validGeneration(source.root_generation) || !validEpoch(source.root_epoch))
  )
    throw new ResponsibilityError("UNAVAILABLE");
  return createHash("sha256")
    .update(
      JSON.stringify([
        RESPONSIBILITY_PROTOCOL,
        target.kind,
        target.id,
        familyId,
        source.generation,
        source.epoch,
        ...(hasRoot
          ? [source.recurrence_id, source.root_generation, source.root_epoch]
          : []),
      ]),
    )
    .digest("hex");
}
/** Caller still must authenticate, take actor/household locks before this target/root lock read, then renew
 * domain/role/subject permissions. This helper supplies no independent authority. */
export async function readResponsibilitySource(
  tx: Reader,
  familyId: string,
  rawTarget: unknown,
) {
  const target = responsibilityTarget.parse(rawTarget);
  if (!(await responsibilityStorageAvailable(tx)))
    throw new ResponsibilityError("UNAVAILABLE");
  let rows: ResponsibilitySourceEpoch[];
  if (target.kind === "chore") {
    // The household lock serializes canonical services; stable target/root row
    // order also avoids introducing a child-then-root lock inversion here.
    const locked = await tx.$queryRaw<
      Array<ResponsibilitySourceEpoch & { id: string }>
    >`
      SELECT "id", "responsibility_generation" AS generation, "responsibility_epoch" AS epoch, "recurrence_id"
      FROM "Chore" WHERE "family_id" = ${familyId}
        AND ("id" = ${target.id} OR "id" = (SELECT "recurrence_id" FROM "Chore" WHERE "id" = ${target.id} AND "family_id" = ${familyId}))
      ORDER BY "id" FOR UPDATE`;
    const row = locked.find((item) => item.id === target.id);
    if (!row) throw new ResponsibilityError("NOT_FOUND");
    const root = row.recurrence_id
      ? locked.find((item) => item.id === row.recurrence_id)
      : null;
    // A concurrent legacy rewrite cannot substitute an unlocked root from a
    // later snapshot. Hold and re-read the complete target instead.
    if (row.recurrence_id && (!root || root.recurrence_id !== root.id))
      throw new ResponsibilityError("UNAVAILABLE");
    rows = [
      {
        ...row,
        root_generation: root?.generation ?? null,
        root_epoch: root?.epoch ?? null,
      },
    ];
  } else if (target.kind === "pickup")
    rows = await tx.$queryRaw<ResponsibilitySourceEpoch[]>`
    SELECT "responsibility_generation" AS generation, "responsibility_epoch" AS epoch
    FROM "Pickup" WHERE "id" = ${target.id} AND "family_id" = ${familyId} FOR UPDATE`;
  else
    rows = await tx.$queryRaw<ResponsibilitySourceEpoch[]>`
    SELECT "responsibility_generation" AS generation, "responsibility_epoch" AS epoch
    FROM "Handoff" WHERE "id" = ${target.id} AND "family_id" = ${familyId} FOR UPDATE`;
  if (rows.length !== 1) throw new ResponsibilityError("NOT_FOUND");
  return responsibilitySourceToken(target, familyId, rows[0]);
}
/** Own current-household participation only. Explicit columns, no target text,
 * source tokens, emails, profile ages, shares or arbitrary future payloads. */
export async function exportResponsibilityState(
  db: Reader,
  userId: string,
  familyId: string | null,
  role: string | undefined,
) {
  if (!(await responsibilityStorageAvailable(db))) return undefined;
  if (!familyId || !["parent", "teen", "child"].includes(role ?? "")) return [];
  return db.$queryRaw<Array<Record<string, unknown>>>`
    SELECT "id", "protocol", "chore_id", "pickup_id", "handoff_id", "revision",
      "coordinator_id", "backup_account_id", "backup_member_id",
      "primary_subject_account_id", "primary_subject_member_id", "primary_decision", "primary_by_id", "primary_method", "primary_at",
      "backup_decision", "backup_by_id", "backup_method", "backup_at", "created_at", "updated_at"
    FROM "ResponsibilityState" r WHERE "family_id" = ${familyId}
      AND (${role !== "child"} OR "handoff_id" IS NULL)
      AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = ${userId} AND u."family_id" = r."family_id" AND u."role" = ${role})
      AND (${userId} IN ("coordinator_id", "backup_account_id", "primary_subject_account_id", "primary_by_id", "backup_by_id")
        OR EXISTS (SELECT 1 FROM "Chore" c WHERE c."id" = r."chore_id" AND c."family_id" = r."family_id" AND c."assigned_to" = ${userId})
        OR EXISTS (SELECT 1 FROM "Pickup" p WHERE p."id" = r."pickup_id" AND p."family_id" = r."family_id" AND p."assigned_to" = ${userId}))
    ORDER BY "created_at" ASC, "id" ASC`;
}
