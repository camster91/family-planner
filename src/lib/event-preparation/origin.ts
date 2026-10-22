/** Immutable copy provenance uses canonical Activity, not a task/plan store.
 * A deterministic primary key binds one fact to one freshly created Chore.
 * Existing Activity household/account erasure and portability remain in force.
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { isProfileChoreEnabled } from "@/lib/profile-chore-gates";
import { parseDateOnly } from "@/lib/dates";
import { eventPreparationReady } from "./owner";
import { eventPreparationStorageAvailable } from "./storage";
import type { PreparationRoutineOrigins } from "./origin-contract";
export const PREPARATION_COPY_ACTION = "preparation_routine_copied";
const originFact = z
  .object({
    timeline: z.literal(1),
    actorKind: z.literal("person"),
    target: z.object({ kind: z.literal("chore"), id }).strict(),
    routineCopy: z
      .object({
        stackId: id,
        sourceChoreId: id,
        occurrenceDay: z
          .string()
          .refine((value) => parseDateOnly(value) !== null),
      })
      .strict(),
  })
  .strict();
export function preparationCopyFactId(familyId: string, choreId: string) {
  return `prep_copy_${createHash("sha256")
    .update(JSON.stringify(["preparation-routine-copy.v1", familyId, choreId]))
    .digest("hex")}`;
}
export async function recordPreparationRoutineCopyInTx(
  tx: Pick<Prisma.TransactionClient, "activity">,
  actor: { userId: string; familyId: string },
  choreId: string,
  origin: { stackId: string; sourceChoreId: string; occurrenceDay: string },
  now: Date,
) {
  const metadata = originFact.parse({
    timeline: 1,
    actorKind: "person",
    target: { kind: "chore", id: choreId },
    routineCopy: origin,
  });
  await tx.activity.create({
    data: {
      id: preparationCopyFactId(actor.familyId, choreId),
      family_id: actor.familyId,
      user_id: actor.userId,
      type: PREPARATION_COPY_ACTION,
      title: "Routine step copied for preparation",
      metadata: JSON.stringify(metadata),
      created_at: now,
    },
    select: { id: true },
  });
}
type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;
export async function readPreparationRoutineOrigins(
  db: Reader,
  input: {
    userId: string;
    familyId: string;
    role: string;
    tokenVersion?: number;
    choreIds: string[];
  },
): Promise<PreparationRoutineOrigins> {
  if (input.role !== "parent" || !eventPreparationReady()) return {};
  const ids = [...new Set(input.choreIds)]
    .filter((value) => id.safeParse(value).success)
    .slice(0, 300);
  if (!ids.length || !(await eventPreparationStorageAvailable(db))) return {};
  const profile = isProfileChoreEnabled(),
    generation = input.tokenVersion ?? null;
  const requested = JSON.stringify(
    ids.map((choreId) => ({
      chore_id: choreId,
      fact_id: preparationCopyFactId(input.familyId, choreId),
    })),
  );
  const rows = await db.$queryRaw<
    Array<{
      chore_id: string;
      metadata: string | null;
      copied_at: Date;
      features: unknown;
    }>
  >`
    SELECT c."id" AS chore_id,a."metadata",a."created_at" AS copied_at,f."features"
    FROM jsonb_to_recordset(${requested}::jsonb) AS wanted(chore_id text,fact_id text)
    JOIN "Chore" c ON c."id"=wanted.chore_id AND c."family_id"=${input.familyId}
    JOIN "Activity" a ON a."id"=wanted.fact_id AND a."family_id"=c."family_id" AND a."type"=${PREPARATION_COPY_ACTION}
    JOIN "Family" f ON f."id"=c."family_id"
    WHERE c."member_subject_erased"=false AND c."is_template"=false
      AND a."subject_member_erased"=false AND (${profile} OR c."assigned_to" IS NOT NULL)
      AND EXISTS(SELECT 1 FROM "User" u WHERE u."id"=${input.userId} AND u."family_id"=c."family_id" AND u."role"='parent'
        AND (${generation}::int IS NULL OR u."token_version"=${generation}))
    ORDER BY c."id" LIMIT 300`;
  const accepted = new Map<
    string,
    { origin: z.infer<typeof originFact>["routineCopy"]; copiedAt: string }
  >();
  const allowed = new Set(ids);
  for (const row of rows) {
    const features = normalizeFeatures(row.features);
    if (
      !allowed.has(row.chore_id) ||
      !row.metadata ||
      row.metadata.length > 4096 ||
      !isFeatureEnabled(features, "chores") ||
      !isFeatureEnabled(features, "calendar")
    )
      continue;
    try {
      const parsed = originFact.parse(JSON.parse(row.metadata));
      if (
        parsed.target.id !== row.chore_id ||
        parsed.routineCopy.sourceChoreId === row.chore_id
      )
        continue;
      accepted.set(row.chore_id, {
        origin: parsed.routineCopy,
        copiedAt: new Date(row.copied_at).toISOString(),
      });
    } catch {
      /* Corrupt facts never become names, links or a manual-task claim. */
    }
  }
  if (!accepted.size) return {};
  const sources = JSON.stringify(
    [...accepted].map(([choreId, value]) => ({
      chore_id: choreId,
      stack_id: value.origin.stackId,
      source_id: value.origin.sourceChoreId,
      day: value.origin.occurrenceDay,
    })),
  );
  const current = await db.$queryRaw<
    Array<{
      chore_id: string;
      stack_id: string;
      source_id: string;
      label: string;
    }>
  >`
    SELECT c."id" AS chore_id,r."id" AS stack_id,s."id" AS source_id,r."label"
    FROM jsonb_to_recordset(${sources}::jsonb) AS wanted(chore_id text,stack_id text,source_id text,day text)
    JOIN "Chore" c ON c."id"=wanted.chore_id AND c."family_id"=${input.familyId}
    JOIN "RoutineStack" r ON r."id"=wanted.stack_id AND r."family_id"=c."family_id"
    JOIN "Chore" s ON s."id"=wanted.source_id AND s."family_id"=c."family_id" AND s."routine_stack_id"=r."id"
    JOIN "Family" f ON f."id"=c."family_id"
    WHERE c."member_subject_erased"=false AND c."is_template"=false AND s."member_subject_erased"=false AND s."is_template"=false
      AND to_char(s."due_date" AT TIME ZONE 'UTC','YYYY-MM-DD')=wanted.day
      AND (${profile} OR (c."assigned_to" IS NOT NULL AND s."assigned_to" IS NOT NULL))
      AND EXISTS(SELECT 1 FROM "User" u WHERE u."id"=${input.userId} AND u."family_id"=c."family_id" AND u."role"='parent'
        AND (${generation}::int IS NULL OR u."token_version"=${generation}))
    ORDER BY c."id" LIMIT 300`;
  // Final renewal also withholds earlier rows if actor/gates changed between reads.
  const renewed = await db.$queryRaw<
    Array<{ features: unknown }>
  >`SELECT f."features" FROM "User" u JOIN "Family" f ON f."id"=u."family_id"
    WHERE u."id"=${input.userId} AND u."family_id"=${input.familyId} AND u."role"='parent' AND (${generation}::int IS NULL OR u."token_version"=${generation})`;
  if (
    !renewed[0] ||
    !isFeatureEnabled(normalizeFeatures(renewed[0].features), "chores") ||
    !isFeatureEnabled(normalizeFeatures(renewed[0].features), "calendar")
  )
    return {};
  const visible = new Map(current.map((row) => [row.chore_id, row]));
  return Object.fromEntries(
    [...accepted].map(([choreId, value]) => {
      const source = visible.get(choreId),
        origin = value.origin;
      return [
        choreId,
        source &&
        source.stack_id === origin.stackId &&
        source.source_id === origin.sourceChoreId
          ? {
              state: "available",
              ...origin,
              label: source.label.slice(0, 200),
              copiedAt: value.copiedAt,
            }
          : { state: "unavailable", copiedAt: value.copiedAt },
      ];
    }),
  );
}
