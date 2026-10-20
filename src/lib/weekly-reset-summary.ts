import type { Prisma } from "@prisma/client";
import { addDaysToKey, dayKeyFor } from "@/lib/local-day-key";
import { parseDateOnly, toDateOnlyUTC } from "@/lib/dates";
import { zonedWallTimeToUtc } from "@/lib/calendar-import/timezone";
import { isFeatureEnabled, type FamilyFeatures } from "@/lib/features";
import { getUseSoonItems } from "@/lib/inventory";
import { getOpenShoppingItems } from "@/lib/shopping-snapshot";
import { routineOccurrencePolicyInTx } from "@/lib/routine-occurrence-policy";
import {
  WEEKLY_RESET_PROTOCOL,
  WeeklyResetError,
  weeklyResetSections,
  type WeeklyResetScope,
  type WeeklyResetStep,
} from "@/lib/weekly-reset";

const LIMIT = 8;
const text = (value: string) =>
  Array.from(value.normalize("NFC")).slice(0, 240).join("");
import {
  weeklyResetSummary,
  type WeeklyResetSummary,
} from "@/lib/weekly-reset-summary-contract";
export {
  weeklyResetSummaryQuery,
  weeklyResetSummary,
} from "@/lib/weekly-reset-summary-contract";
type Group = WeeklyResetSummary["groups"][number];
type SummaryActor = {
  userId: string;
  familyId: string;
  role: string;
  emailVerified: boolean;
};

function midnight(day: string, timeZone: string) {
  const [year, month, date] = day.split("-").map(Number);
  return zonedWallTimeToUtc(
    { year, month, day: date, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}
export function weeklyResetWindow(scope: WeeklyResetScope) {
  const end = addDaysToKey(scope.weekStart, 7);
  return {
    dateStart: parseDateOnly(scope.weekStart)!,
    dateEnd: parseDateOnly(end)!,
    instantStart: midnight(scope.weekStart, scope.timeZone),
    instantEnd: midnight(end, scope.timeZone),
  };
}
/** Caller holds current actor + household locks. One requested, permitted step
 * only; no provider, external calendar refresh, routine top-up or domain write.
 * A failed source rejects the entire step, never an empty-success projection. */
export async function loadWeeklyResetSummaryInTx(
  tx: Prisma.TransactionClient,
  actor: SummaryActor,
  features: FamilyFeatures,
  scope: WeeklyResetScope,
  step: WeeklyResetStep,
  now = new Date(),
): Promise<WeeklyResetSummary> {
  if (!weeklyResetSections(actor.role, features).some((row) => row.id === step))
    throw new WeeklyResetError("STEP_UNAVAILABLE");
  const window = weeklyResetWindow(scope);
  const family_id = actor.familyId;
  const groups: Group[] = [];
  const notes: WeeklyResetSummary["notes"] = [];
  if (step === "schedule") {
    notes.push("storedScheduleOnly");
    if (isFeatureEnabled(features, "calendar")) {
      const rows = await tx.event.findMany({
        where: {
          family_id,
          start_time: { lt: window.instantEnd },
          end_time: { gt: window.instantStart },
        },
        select: { title: true, start_time: true, end_time: true },
        orderBy: [{ start_time: "asc" }, { id: "asc" }],
        take: LIMIT + 1,
      });
      // Same shared-safe title/time fields as Today, including for children.
      // No description, address, attendee inference or private provider token.
      groups.push({
        kind: "events",
        more: rows.length > LIMIT,
        rows: rows.slice(0, LIMIT).map((row) => ({
          title: text(row.title),
          when: row.start_time.toISOString(),
          end: row.end_time.toISOString(),
        })),
      });
    }
  }
  if (step === "responsibilities") {
    notes.push("acceptanceAndBackupUnknown");
    if (isFeatureEnabled(features, "chores")) {
      // Personal account tasks only. Profile identity never authenticates the
      // viewer. Full email-free/profile routine review stays in canonical UI.
      const rows = await tx.chore.findMany({
        where: {
          family_id,
          assigned_to: actor.role === "parent" ? { not: null } : actor.userId,
          member_subject_erased: false,
          due_date: { gte: window.dateStart, lt: window.dateEnd },
          status: { in: ["pending", "in_progress", "overdue"] },
          assignee: { is: { family_id } },
        },
        select: { id: true, title: true, due_date: true, assigned_to: true },
        orderBy: [{ due_date: "asc" }, { id: "asc" }],
        take: LIMIT + 1,
      });
      const visible = [];
      for (const row of rows) {
        const policy = await routineOccurrencePolicyInTx(tx, family_id, row.id);
        if (policy === "inactive" || policy === "unsupported") continue;
        visible.push({
          title: text(row.title),
          when: toDateOnlyUTC(row.due_date),
          owner:
            row.assigned_to === actor.userId
              ? ("you" as const)
              : ("assigned" as const),
        });
      }
      groups.push({
        kind: "chores",
        rows: visible.slice(0, LIMIT),
        more: rows.length > LIMIT,
      });
      notes.push("profileChoresInChores");
      if (visible.length !== rows.length) notes.push("boundedPreview");
    }
    if (isFeatureEnabled(features, "pickups")) {
      const rows = await tx.pickup.findMany({
        where: {
          family_id,
          completed: false,
          pickup_time: { gte: window.instantStart, lt: window.instantEnd },
        },
        select: {
          title: true,
          pickup_time: true,
          assigned_to: true,
          assignee: { select: { family_id: true } },
        },
        orderBy: [{ pickup_time: "asc" }, { id: "asc" }],
        take: LIMIT + 1,
      });
      groups.push({
        kind: "pickups",
        more: rows.length > LIMIT,
        rows: rows.slice(0, LIMIT).map((row) => ({
          title: text(row.title),
          when: row.pickup_time.toISOString(),
          owner: !row.assigned_to
            ? "unassigned"
            : row.assignee?.family_id !== family_id
              ? "unknown"
              : row.assigned_to === actor.userId
                ? "you"
                : "assigned",
        })),
      });
    }
    if (isFeatureEnabled(features, "handoff")) {
      const rows = await tx.handoff.findMany({
        where: {
          family_id,
          arrival_time: { gte: window.instantStart, lt: window.instantEnd },
        },
        select: { sitter_name: true, arrival_time: true, departure_time: true },
        orderBy: [{ arrival_time: "asc" }, { id: "asc" }],
        take: LIMIT + 1,
      });
      groups.push({
        kind: "handoffs",
        more: rows.length > LIMIT,
        rows: rows.slice(0, LIMIT).map((row) => ({
          title: text(row.sitter_name),
          when: row.arrival_time?.toISOString() ?? null,
          end: row.departure_time?.toISOString() ?? null,
        })),
      });
    }
  }
  if (step === "meals") {
    const rows = await tx.familyMeal.findMany({
      where: { family_id, date: { gte: window.dateStart, lt: window.dateEnd } },
      select: { recipe_name: true, date: true },
      orderBy: [{ date: "asc" }, { created_at: "asc" }, { id: "asc" }],
      take: LIMIT + 1,
    });
    groups.push({
      kind: "meals",
      more: rows.length > LIMIT,
      rows: rows.slice(0, LIMIT).map((row) => ({
        title: text(row.recipe_name ?? ""),
        when: toDateOnlyUTC(row.date),
      })),
    });
  }
  if (step === "prep") {
    // Preserve the canonical bulk-prep read's verified-email requirement.
    if (!actor.emailVerified) notes.push("prepRequiresVerifiedEmail");
    else {
      const sessions = await tx.mealPrepSession.findMany({
        where: {
          family_id,
          OR: [
            { prepared_on: { gte: window.dateStart, lt: window.dateEnd } },
            { prepared_at: { not: null }, prepared_on: { lt: window.dateEnd } },
            { next_prep_on: { gte: window.dateStart, lt: window.dateEnd } },
          ],
        },
        select: {
          prepared_on: true,
          next_prep_on: true,
          prepared_at: true,
          batches: {
            where: { family_id },
            orderBy: { position: "asc" },
            take: LIMIT + 1,
            select: { id: true, name: true, total_servings: true },
          },
        },
        orderBy: [{ prepared_on: "desc" }, { id: "desc" }],
        take: LIMIT + 1,
      });
      const dishRows: Group["rows"] = [];
      let more = sessions.length > LIMIT;
      for (const session of sessions.slice(0, LIMIT)) {
        more ||= session.batches.length > LIMIT;
        for (const batch of session.batches.slice(0, LIMIT)) {
          if (dishRows.length >= LIMIT) {
            more = true;
            break;
          }
          // Aggregate all active consumption, not a capped history preview.
          const total = await tx.mealBatchConsumption.aggregate({
            where: { family_id, batch_id: batch.id, cancelled_at: null },
            _sum: { servings: true },
          });
          const eaten = total._sum.servings ?? 0;
          if (
            !Number.isSafeInteger(eaten) ||
            eaten < 0 ||
            eaten > batch.total_servings
          )
            throw new WeeklyResetError("UNAVAILABLE");
          dishRows.push({
            title: text(batch.name),
            when: toDateOnlyUTC(session.prepared_on),
            prepared: session.prepared_at !== null,
            quantity: batch.total_servings,
            eaten,
            ...(session.prepared_at
              ? { remaining: batch.total_servings - eaten }
              : {}),
            nextPrep: session.next_prep_on
              ? toDateOnlyUTC(session.next_prep_on)
              : null,
          });
        }
      }
      groups.push({ kind: "prep", rows: dishRows, more });
    }
  }
  if (step === "food") {
    // Safety status always uses today's actual local day, never an old/future
    // review's Monday. Past use-by items must not be suggested as usable food.
    const today = parseDateOnly(
      dayKeyFor({ kind: "tz", timeZone: scope.timeZone })(now),
    )!;
    const rows = await getUseSoonItems(tx, family_id, {
      today,
      days: 6,
      limit: LIMIT + 1,
    });
    notes.push("currentFoodSnapshot");
    groups.push({
      kind: "food",
      more: rows.length > LIMIT,
      rows: rows.slice(0, LIMIT).map((row) => ({
        title: text(row.name),
        when: row.expiresOn,
        dateKind: row.dateKind,
      })),
    });
  }
  if (step === "groceries") {
    const snapshot = await getOpenShoppingItems(tx, family_id, LIMIT, [
      "grocery",
    ]);
    groups.push({
      kind: "groceries",
      total: snapshot.total,
      more: snapshot.total > snapshot.items.length,
      rows: snapshot.items.map((row) => ({
        title: text(row.content),
        when: null,
        quantity: row.quantity,
      })),
    });
    // Open groceries are not evidence of complete recipe ingredient coverage.
    notes.push("groceryGapsNotAssessed");
  }
  return weeklyResetSummary.parse({
    protocol: WEEKLY_RESET_PROTOCOL,
    owner: { userId: actor.userId, familyId: family_id },
    scope,
    step,
    generatedAt: now.toISOString(),
    groups,
    notes,
  });
}
