/** Additive raw-schema compatibility only. No authorization or activation.
 * Canonical Event/Chore owns the content and its normal deletion semantics. */
import type { Prisma } from "@prisma/client";
type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;
export async function eventPreparationStorageAvailable(tx: Reader) {
  const rows = await tx.$queryRaw<Array<{ ready: boolean }>>`
  SELECT to_regclass('public."EventPreparation"') IS NOT NULL AND to_regclass('public."EventPreparationStep"') IS NOT NULL
   AND (SELECT COUNT(*)=3 FROM pg_attribute WHERE attrelid=to_regclass('public."Event"') AND NOT attisdropped AND attnotnull AND attname IN ('schedule_generation','schedule_epoch','preparation_epoch'))
   AND (SELECT COUNT(*)=7 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled IN ('O','A') AND (
    (tgrelid=to_regclass('public."Event"') AND tgname IN ('herewoven_preparation_epoch','herewoven_preparation_event_move')) OR
    (tgrelid=to_regclass('public."EventPreparation"') AND tgname IN ('herewoven_preparation_identity','herewoven_preparation_lifecycle')) OR
    (tgrelid=to_regclass('public."EventPreparationStep"') AND tgname IN ('herewoven_preparation_identity','herewoven_preparation_step_version')) OR
    (tgrelid=to_regclass('public."Chore"') AND tgname='herewoven_preparation_chore_move')
   )) AS ready`;
  return rows[0]?.ready === true;
}
/** Called only from authorized locked whole-household deletion AFTER canonical
 * Event deletion. Its FK cascade already removed links/plans; the named cleanup
 * inventory remains explicit and works with older generated Prisma clients.
 * No readiness switch or assumption that the additive tables exist. */
export async function clearHouseholdEventPreparationInTx(
  tx: Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">,
  familyId: string,
  kind: "steps" | "plans",
) {
  if (kind === "steps") {
    const rows = await tx.$queryRaw<
      Array<{ present: boolean }>
    >`SELECT to_regclass('public."EventPreparationStep"') IS NOT NULL AS present`;
    if (rows[0]?.present === true)
      await tx.$executeRaw`DELETE FROM "EventPreparationStep" WHERE "family_id" = ${familyId}`;
  } else {
    const rows = await tx.$queryRaw<
      Array<{ present: boolean }>
    >`SELECT to_regclass('public."EventPreparation"') IS NOT NULL AS present`;
    if (rows[0]?.present === true)
      await tx.$executeRaw`DELETE FROM "EventPreparation" WHERE "family_id" = ${familyId}`;
  }
}

/** Portability follows the caller's already-exported canonical records. Parent
 * only until narrower child/profile read projections are implemented; no new
 * event/task visibility is granted through these relationship rows. The query
 * renews current parent membership and requires both scoped canonical records. */
export async function exportEventPreparation(
  tx: Reader,
  input: {
    userId: string;
    familyId: string | null;
    role: string | undefined;
    eventIds: string[];
    choreIds: string[];
  },
) {
  if (!input.familyId || input.role !== "parent") return [];
  if (!(await eventPreparationStorageAvailable(tx))) return undefined;
  if (!input.eventIds.length || !input.choreIds.length) return [];
  // jsonb arrays are bound values, never interpolated SQL identifiers/text.
  const events = JSON.stringify([...new Set(input.eventIds)]);
  const chores = JSON.stringify([...new Set(input.choreIds)]);
  return tx.$queryRaw<
    Array<{
      id: string;
      event_id: string;
      revision: number;
      steps: {
        id: string;
        chore_id: string;
        position: number;
        cue_anchor: string | null;
        cue_direction: string | null;
        cue_minutes: number | null;
      }[];
    }>
  >`
    SELECT p."id", p."event_id", p."revision",
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', s."id", 'chore_id', s."chore_id", 'position', s."position",
        'cue_anchor', s."cue_anchor", 'cue_direction', s."cue_direction", 'cue_minutes', s."cue_minutes"
      ) ORDER BY s."position", s."id") FROM "EventPreparationStep" s
      JOIN "Chore" c ON c."id"=s."chore_id" AND c."family_id"=s."family_id"
      WHERE s."preparation_id"=p."id" AND s."family_id"=p."family_id"
        AND c."id" IN (SELECT jsonb_array_elements_text(${chores}::jsonb))), '[]'::jsonb) AS steps
    FROM "EventPreparation" p
    JOIN "Event" e ON e."id"=p."event_id" AND e."family_id"=p."family_id"
    WHERE p."family_id"=${input.familyId}
      AND e."id" IN (SELECT jsonb_array_elements_text(${events}::jsonb))
      AND EXISTS (SELECT 1 FROM "User" u WHERE u."id"=${input.userId}
        AND u."family_id"=p."family_id" AND u."role"='parent')
    ORDER BY p."event_id", p."id"`;
}
