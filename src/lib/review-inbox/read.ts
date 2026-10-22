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
    source: z
      .enum(["checks", "preparation", "saved", "capture", "changes"])
      .default("checks"),
    after: memberIdentityIdSchema.optional(),
  })
  .strict();
export type InboxItem = {
  id: string;
  title: string;
  kind: "check" | "preparation";
};
export type InboxPage = {
  source: "checks" | "preparation" | "saved" | "capture" | "changes";
  items: InboxItem[];
  next: string | null;
  state: "available" | "paused" | "forbidden";
};
type Db = Pick<Prisma.TransactionClient, "$queryRaw">;
export async function readReviewInbox(
  db: Db,
  actor: {
    userId: string;
    familyId: string;
    role: string;
    tokenVersion: number;
  },
  raw: z.input<typeof inboxQuery>,
): Promise<InboxPage> {
  const query = inboxQuery.parse(raw);
  const empty = (state: InboxPage["state"]): InboxPage => ({
    source: query.source,
    items: [],
    next: null,
    state,
  });
  if (
    actor.role !== "parent" ||
    !Number.isSafeInteger(actor.tokenVersion) ||
    actor.tokenVersion < 0
  )
    return empty("forbidden");
  if (
    query.source === "saved" ||
    query.source === "capture" ||
    query.source === "changes"
  ) {
    // Client-owned draft hosts still need a current owner before mounting.
    const current = await db.$queryRaw<Array<{ id: string }>>`
      SELECT u."id" FROM "User" u
      WHERE u."id"=${actor.userId} AND u."family_id"=${actor.familyId}
        AND u."role"='parent' AND u."token_version"=${actor.tokenVersion}`;
    return empty(current.length ? "available" : "forbidden");
  }
  const after = query.after ?? "";
  if (query.source === "checks") {
    // A current-authority row survives an empty candidate set via LEFT JOIN.
    // No authority rows means forbidden, never a misleading empty inbox.
    const rows = await db.$queryRaw<
      Array<{ id: string | null; title: string | null; features: unknown }>
    >`
      SELECT pending."id", pending."title", f."features" FROM "User" u
      JOIN "Family" f ON f."id"=u."family_id"
      LEFT JOIN LATERAL (
        SELECT c."id", c."title" FROM "Chore" c
        WHERE c."family_id"=u."family_id" AND c."status"='completed'
          AND c."is_template"=false AND c."id">${after}
        ORDER BY c."id" LIMIT 21
      ) pending ON true
      WHERE u."id"=${actor.userId} AND u."family_id"=${actor.familyId}
        AND u."role"='parent' AND u."token_version"=${actor.tokenVersion}
      ORDER BY pending."id"`;
    if (!rows.length) return empty("forbidden");
    const candidates = rows.flatMap((row) =>
      typeof row.id === "string" && typeof row.title === "string"
        ? [{ ...row, id: row.id, title: row.title }]
        : [],
    );
    return {
      source: query.source,
      state: "available",
      next: candidates.length > 20 ? candidates[19].id : null,
      items: candidates
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
      id: string | null;
      title: string | null;
      generation: string | null;
      epoch: number | null;
      reviewed: string | null;
      features: unknown;
    }>
  >`
    SELECT pending."id", pending."title", pending."generation", pending."epoch",
      pending."reviewed", f."features" FROM "User" u
    JOIN "Family" f ON f."id"=u."family_id"
    LEFT JOIN LATERAL (
      SELECT e."id", e."title", e."schedule_generation" AS generation,
        e."schedule_epoch" AS epoch, p."reviewed_event_source" AS reviewed
      FROM "EventPreparation" p
      JOIN "Event" e ON e."id"=p."event_id" AND e."family_id"=p."family_id"
      WHERE p."family_id"=u."family_id" AND e."id">${after}
      ORDER BY e."id" LIMIT 21
    ) pending ON true
    WHERE u."id"=${actor.userId} AND u."family_id"=${actor.familyId}
      AND u."role"='parent' AND u."token_version"=${actor.tokenVersion}
    ORDER BY pending."id"`;
  if (!rows.length) return empty("forbidden");
  const candidates = rows.flatMap((row) =>
    typeof row.id === "string" && typeof row.title === "string"
      ? [{ ...row, id: row.id, title: row.title }]
      : [],
  );
  return {
    source: query.source,
    state: "available",
    next: candidates.length > 20 ? candidates[19].id : null,
    items: candidates.slice(0, 20).flatMap((row) => {
      const features = normalizeFeatures(row.features);
      if (
        !isFeatureEnabled(features, "chores") ||
        !isFeatureEnabled(features, "calendar")
      )
        return [];
      try {
        if (
          row.generation !== null &&
          row.epoch !== null &&
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
