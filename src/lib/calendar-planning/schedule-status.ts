/** Content-minimal source freshness metadata. Never select URLs/tokens/cursors,
 * source names or calendars' private identifiers. Not a provider refresh. */
import { ScheduleReviewError } from "./conflict-review";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
export const scheduleSourceStatus = z
  .object({
    kind: z.enum(["subscription", "connection"]),
    id,
    status: z.string().max(40),
    checkedAt: z.date().nullable(),
    updatedAt: z.date(),
    generation: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type ScheduleSourceStatus = z.infer<typeof scheduleSourceStatus>;
export function scheduleStatusQuery(familyId: string) {
  id.parse(familyId);
  return Prisma.sql`
    SELECT * FROM (
      SELECT 'subscription'::text AS kind, "id", "last_status" AS status, "last_fetched_at" AS "checkedAt", "updated_at" AS "updatedAt", NULL::integer AS generation FROM "CalendarSubscription" WHERE "family_id" = ${familyId}
      UNION ALL
      SELECT 'connection'::text AS kind, "id", "status", "last_synced_at" AS "checkedAt", "updated_at" AS "updatedAt", "generation" FROM "CalendarConnection" WHERE "family_id" = ${familyId}
    ) AS sources ORDER BY kind, "id" LIMIT 101`;
}
export async function readScheduleStatuses(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  familyId: string,
) {
  const parsed = z
    .array(scheduleSourceStatus)
    .max(101)
    .safeParse(await tx.$queryRaw(scheduleStatusQuery(familyId)));
  if (!parsed.success) throw new ScheduleReviewError("UNAVAILABLE");
  return parsed.data;
}
export function scheduleStatusToken(statuses: ScheduleSourceStatus[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        statuses
          .map((row) => [
            row.kind,
            row.id,
            row.status,
            row.checkedAt?.toISOString() ?? null,
            row.updatedAt.toISOString(),
            row.generation,
          ])
          .sort((a, b) => {
            const left = JSON.stringify(a),
              right = JSON.stringify(b);
            return left < right ? -1 : left > right ? 1 : 0;
          }),
      ),
    )
    .digest("hex");
}

/** Shared source policy for rescheduling and food planning. No provider refresh. */
export const SCHEDULE_SOURCE_FRESHNESS_MS = 24 * 60 * 60 * 1000;
export function assessScheduleSourceCoverage(
  rows: readonly {
    sourceSubscriptionId: string | null;
    sourceConnectionId: string | null;
  }[],
  statuses: ScheduleSourceStatus[],
  now: Date,
) {
  const localSources = new Set(statuses.map((row) => `${row.kind}:${row.id}`));
  const missingSource = rows.some(
    (row) =>
      (row.sourceSubscriptionId &&
        !localSources.has(`subscription:${row.sourceSubscriptionId}`)) ||
      (row.sourceConnectionId &&
        !localSources.has(`connection:${row.sourceConnectionId}`)),
  );
  const sourcesUnavailable =
    statuses.some(
      (row) =>
        row.status !== "ok" ||
        row.checkedAt === null ||
        !Number.isFinite(+now) ||
        +now - +row.checkedAt > SCHEDULE_SOURCE_FRESHNESS_MS ||
        +row.checkedAt - +now > 60000,
    ) || !!missingSource;
  return {
    capped: rows.length > 500 || statuses.length > 100,
    sourcesUnavailable,
    missingSource: !!missingSource,
  };
}
