/** Read-only parent inbox. Each item opens its canonical domain review; there is
 * no competing completion store, bulk approval or autonomous mutation. */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { memberIdentityIdSchema } from "@/lib/member-subject-contract";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { eventPreparationReady } from "@/lib/event-preparation/owner";
import { eventPreparationStorageAvailable } from "@/lib/event-preparation/storage";
import { scheduleEventToken } from "@/lib/calendar-planning/schedule-source";
export const inboxQuery = z
  .object({
    source: z.enum(["checks", "preparation", "saved"]).default("checks"),
    after: memberIdentityIdSchema.optional(),
  })
  .strict();
export type InboxItem = {
  id: string;
  title: string;
  kind: "check" | "preparation";
};
export type InboxPage = {
  source: "checks" | "preparation" | "saved";
  items: InboxItem[];
  next: string | null;
  state: "available" | "paused" | "forbidden";
};
type Db = Pick<Prisma.TransactionClient, "$queryRaw">;
export async function readReviewInbox(
  db: Db,
  actor: { userId: string; familyId: string; role: string },
  raw: z.input<typeof inboxQuery>,
): Promise<InboxPage> {
  const query = inboxQuery.parse(raw);
  const empty = (state: InboxPage["state"]): InboxPage => ({
    source: query.source,
    items: [],
    next: null,
    state,
  });
  if (actor.role !== "parent") return empty("forbidden");
  if (query.source === "saved") return empty("available");
  const after = query.after ?? "";
  if (query.source === "checks") {
    const rows = await db.$queryRaw<
      Array<{ id: string; title: string; features: unknown }>
    >`
      SELECT c."id", c."title", f."features" FROM "Chore" c
      JOIN "Family" f ON f."id"=c."family_id"
      WHERE c."family_id"=${actor.familyId} AND c."status"='completed'
        AND c."is_template"=false AND c."id">${after}
        AND EXISTS (SELECT 1 FROM "User" u WHERE u."id"=${actor.userId} AND u."family_id"=c."family_id" AND u."role"='parent')
      ORDER BY c."id" LIMIT 21`;
    return {
      source: query.source,
      state: "available",
      next: rows.length > 20 ? rows[19].id : null,
      items: rows
        .slice(0, 20)
        .filter((row) =>
          isFeatureEnabled(normalizeFeatures(row.features), "chores"),
        )
        .map((row) => ({
          id: row.id,
          title: row.title.slice(0, 512),
          kind: "check",
        })),
    };
  }
  if (!eventPreparationReady() || !(await eventPreparationStorageAvailable(db)))
    return empty("paused");
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      title: string;
      generation: string;
      epoch: number;
      reviewed: string;
      features: unknown;
    }>
  >`
    SELECT e."id", e."title", e."schedule_generation" AS generation,
      e."schedule_epoch" AS epoch, p."reviewed_event_source" AS reviewed, f."features"
    FROM "EventPreparation" p
    JOIN "Event" e ON e."id"=p."event_id" AND e."family_id"=p."family_id"
    JOIN "Family" f ON f."id"=p."family_id"
    WHERE p."family_id"=${actor.familyId} AND e."id">${after}
      AND EXISTS (SELECT 1 FROM "User" u WHERE u."id"=${actor.userId} AND u."family_id"=p."family_id" AND u."role"='parent')
    ORDER BY e."id" LIMIT 21`;
  return {
    source: query.source,
    state: "available",
    next: rows.length > 20 ? rows[19].id : null,
    items: rows.slice(0, 20).flatMap((row) => {
      const features = normalizeFeatures(row.features);
      if (
        !isFeatureEnabled(features, "chores") ||
        !isFeatureEnabled(features, "calendar")
      )
        return [];
      try {
        if (
          scheduleEventToken(actor.familyId, {
            id: row.id,
            generation: row.generation,
            epoch: row.epoch,
          }) === row.reviewed
        )
          return [];
      } catch {
        /* Invalid/saturated versions need review, never silently clear. */
      }
      return [
        {
          id: row.id,
          title: row.title.slice(0, 512),
          kind: "preparation" as const,
        },
      ];
    }),
  };
}
