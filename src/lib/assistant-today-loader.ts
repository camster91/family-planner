import type { AssistantSourceRow } from "./assistant-references";
/**
 * Narrow, server-only Today reads for the dormant Family AI broker.
 *
 * This loader intentionally does not reuse the visual Today board. The board
 * also loads display settings, ambient photos and optional weather, while a
 * provider context needs only a small allowlisted set of rows. Nothing in the
 * return type contains a record or member id.
 */
import type { PrismaClient } from "@prisma/client";
import { addUTCDays, toDateOnlyUTC } from "@/lib/dates";
import { addDaysToKey } from "@/lib/local-day-key";
import { zonedWallTimeToUtc } from "@/lib/calendar-import/timezone";
import {
  DEFAULT_USE_SOON_DAYS,
  asDateKind,
  expiryLabel,
  expiryStatus,
  isUseSoonStatus,
} from "@/lib/inventory-display";
import type {
  AssistantTodayChore,
  AssistantTodayDinner,
  AssistantTodayEvent,
  AssistantTodayGrocery,
  AssistantTodayStatus,
  AssistantTodayUseSoon,
} from "@/lib/assistant-today-context";

const MAX_EVENTS = 20;
const MAX_CHORES = 30;
const MAX_GROCERIES = 20;
const MAX_USE_SOON = 20;
const MAX_TEXT_BYTES = 512;
const MAX_SOURCE_BYTES = 128;

export type AssistantTodayLoaderRole = "parent" | "teen";

export type AssistantTodayLoaderFeatures = Pick<
  Record<string, boolean>,
  "calendar" | "chores" | "lists" | "meals" | "inventory"
>;

export type AssistantTodayLoaderDb = Pick<
  PrismaClient,
  "user" | "event" | "chore" | "familyMeal" | "listItem" | "inventoryItem"
>;

export interface AssistantTodayLoadedRows {
  events: AssistantTodayEvent[];
  chores: AssistantTodayChore[];
  dinner: AssistantTodayDinner | null;
  groceries: AssistantTodayGrocery[];
  useSoon: AssistantTodayUseSoon[];
}

export interface LoadAssistantTodayRowsInput {
  familyId: string;
  userId: string;
  role: AssistantTodayLoaderRole;
  features: AssistantTodayLoaderFeatures;
  serverNow: Date;
  viewerTimeZone: string;
  onSources?: (sources: AssistantSourceRow[]) => void;
}

function boundedText(
  value: string | null | undefined,
  maxBytes = MAX_TEXT_BYTES,
): string {
  const normalized = (value ?? "").normalize("NFC");
  if (Buffer.byteLength(normalized, "utf8") <= maxBytes) return normalized;
  let result = "";
  for (const character of normalized) {
    if (Buffer.byteLength(result + character, "utf8") > maxBytes) break;
    result += character;
  }
  return result;
}

function boundedSource(value: string | null | undefined): string | null {
  const result = boundedText(value, MAX_SOURCE_BYTES).trim();
  return result || null;
}

function statusFor(value: string): AssistantTodayStatus {
  switch (value) {
    case "pending":
    case "open":
      return "open";
    case "in_progress":
      return "in_progress";
    case "completed":
    case "verified":
    case "done":
      return "done";
    case "overdue":
      return "overdue";
    default:
      return "unknown";
  }
}

function dateParts(date: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function localDateFor(date: Date, timeZone: string): string {
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localDateTimeFor(date: Date, timeZone: string): string {
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function dateOnlyStart(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function localDayWindow(
  serverNow: Date,
  timeZone: string,
): {
  localDate: string;
  localStart: Date;
  localEnd: Date;
  dateStart: Date;
  dateEnd: Date;
} {
  const localDate = localDateFor(serverNow, timeZone);
  const localEndDate = addDaysToKey(localDate, 1);
  const wallMidnight = (dateKey: string) => {
    const [year, month, day] = dateKey.split("-").map(Number);
    return zonedWallTimeToUtc(
      { year, month, day, hour: 0, minute: 0, second: 0 },
      timeZone,
    );
  };
  return {
    localDate,
    localStart: wallMidnight(localDate),
    localEnd: wallMidnight(localEndDate),
    dateStart: dateOnlyStart(localDate),
    dateEnd: dateOnlyStart(localEndDate),
  };
}

function eventIsOnLocalDay(
  event: { start_time: Date; end_time: Date },
  localStart: Date,
  localEnd: Date,
): boolean {
  return (
    event.start_time.getTime() < localEnd.getTime() &&
    event.end_time.getTime() > localStart.getTime()
  );
}

function safePlace(value: string | null | undefined): string {
  switch (value) {
    case "fridge":
    case "freezer":
    case "pantry":
      return value;
    default:
      return "household storage";
  }
}

/**
 * Read and project only the Today fields that the assistant contract permits.
 * Parent reads are household-scoped; teen chore reads are actor-scoped in the
 * database predicate, before projection, so sibling titles never enter memory.
 */
export async function loadAssistantTodayRows(
  db: AssistantTodayLoaderDb,
  input: LoadAssistantTodayRowsInput,
): Promise<AssistantTodayLoadedRows> {
  const day = localDayWindow(input.serverNow, input.viewerTimeZone);
  const { localDate, localStart, localEnd, dateStart, dateEnd } = day;
  const inventoryHorizon = addUTCDays(dateStart, DEFAULT_USE_SOON_DAYS);
  const sources: AssistantSourceRow[] = [];
  function source(
    kind: AssistantSourceRow["kind"],
    row: { id?: string; created_at?: Date },
    index: number,
    label: string,
    extra?: { containerId?: string; dependencies?: unknown },
  ) {
    if (!input.onSources) return;
    if (
      !row.id ||
      !(row.created_at instanceof Date) ||
      !Number.isFinite(row.created_at.getTime())
    )
      throw new Error("Reference source unavailable");
    sources.push({
      kind,
      id: row.id,
      index,
      label: boundedText(label),
      ...(extra?.containerId ? { containerId: extra.containerId } : {}),
      versionInput: { row, dependencies: extra?.dependencies ?? null },
    });
  }

  const namesPromise =
    input.role === "parent" && input.features.chores
      ? db.user.findMany({
          where: { family_id: input.familyId },
          select: { id: true, name: true },
          orderBy: [{ created_at: "asc" }, { id: "asc" }],
          take: 200,
        })
      : Promise.resolve([] as Array<{ id: string; name: string }>);

  const eventsPromise = input.features.calendar
    ? db.event.findMany({
        where: {
          family_id: input.familyId,
          // Query the actual local-day overlap before applying the cap. The
          // bounds are timezone/DST-aware instants, not a fixed 24h UTC span.
          end_time: { gt: localStart },
          start_time: { lt: localEnd },
        },
        select: {
          ...(input.onSources
            ? {
                id: true,
                created_at: true,
                updated_at: true,
                schedule_generation: true,
                schedule_epoch: true,
              }
            : {}),
          title: true,
          start_time: true,
          end_time: true,
          is_task: true,
          // Presence supplies a fixed source label. Only an opaque relation
          // id is selected; arbitrary source names never enter the projection.
          source_subscription: { select: { id: true } },
          source_connection: { select: { id: true } },
        },
        orderBy: [{ start_time: "asc" }, { id: "asc" }],
        take: MAX_EVENTS * 3,
      })
    : Promise.resolve([]);

  const choresPromise = input.features.chores
    ? db.chore.findMany({
        where: {
          family_id: input.familyId,
          // Chores are date-only values stored at UTC midnight. Query the
          // exact viewer day so adjacent-day rows cannot consume the limit.
          due_date: { gte: dateStart, lt: dateEnd },
          is_template: false,
          member_subject_erased: false,
          ...(input.role === "teen"
            ? { assigned_to: input.userId, assigned_member_id: null }
            : {}),
        },
        select: {
          ...(input.onSources
            ? {
                id: true,
                created_at: true,
                preparation_epoch: true,
                responsibility_generation: true,
                responsibility_epoch: true,
              }
            : {}),
          title: true,
          due_date: true,
          status: true,
          assigned_to: true,
        },
        orderBy: [{ due_date: "asc" }, { created_at: "asc" }, { id: "asc" }],
        take: input.role === "teen" ? MAX_CHORES : MAX_CHORES * 2,
      })
    : Promise.resolve([]);

  const dinnersPromise = input.features.meals
    ? db.familyMeal.findMany({
        where: {
          family_id: input.familyId,
          meal_type: "dinner",
          date: { gte: dateStart, lt: dateEnd },
        },
        select: {
          ...(input.onSources
            ? { id: true, created_at: true, updated_at: true }
            : {}),
          date: true,
          recipe_name: true,
          cook: { select: { id: true, name: true, family_id: true } },
          recipe: {
            select: {
              title: true,
              prep_time: true,
              family_id: true,
              ...(input.onSources ? { id: true, updated_at: true } : {}),
            },
          },
        },
        orderBy: [{ date: "asc" }, { created_at: "asc" }, { id: "asc" }],
        take: 20,
      })
    : Promise.resolve([]);

  const groceriesPromise = input.features.lists
    ? db.listItem.findMany({
        where: {
          checked: false,
          list: { family_id: input.familyId, type: "grocery" },
        },
        select: {
          ...(input.onSources
            ? { id: true, created_at: true, updated_at: true }
            : {}),
          content: true,
          quantity: true,
          list: {
            select: {
              name: true,
              ...(input.onSources ? { id: true, updated_at: true } : {}),
            },
          },
        },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
        take: MAX_GROCERIES,
      })
    : Promise.resolve([]);

  const useSoonPromise = input.features.inventory
    ? db.inventoryItem.findMany({
        where: {
          family_id: input.familyId,
          status: "active",
          expires_on: { not: null, lte: inventoryHorizon },
          AND: [
            {
              OR: [
                { date_kind: { not: "use_by" } },
                { expires_on: { gte: dateStart } },
              ],
            },
            { OR: [{ amount: null }, { amount: { gt: 0 } }] },
          ],
        },
        select: {
          ...(input.onSources
            ? { id: true, created_at: true, updated_at: true }
            : {}),
          name: true,
          location: true,
          expires_on: true,
          date_kind: true,
        },
        orderBy: [
          { expires_on: "asc" },
          { date_kind: "desc" },
          { name: "asc" },
          { id: "asc" },
        ],
        take: MAX_USE_SOON,
      })
    : Promise.resolve([]);

  const [names, eventRows, choreRows, dinnerRows, groceryRows, useSoonRows] =
    await Promise.all([
      namesPromise,
      eventsPromise,
      choresPromise,
      dinnersPromise,
      groceriesPromise,
      useSoonPromise,
    ]);
  const namesById = new Map(names.map((member) => [member.id, member.name]));

  const events: AssistantTodayEvent[] = eventRows
    .filter((event) => eventIsOnLocalDay(event, localStart, localEnd))
    .slice(0, MAX_EVENTS)
    .map((event, index) => {
      source("event", event, index, event.title);
      return {
        title: boundedText(event.title),
        localStart: localDateTimeFor(event.start_time, input.viewerTimeZone),
        localEnd: localDateTimeFor(event.end_time, input.viewerTimeZone),
        isTask: event.is_task,
        source: event.source_subscription
          ? "Subscribed calendar"
          : event.source_connection
            ? "Connected calendar"
            : null,
      };
    });

  const chores: AssistantTodayChore[] = choreRows
    .filter(
      (chore) => input.role === "parent" || chore.assigned_to === input.userId,
    )
    .filter((chore) => toDateOnlyUTC(chore.due_date) === localDate)
    .slice(0, MAX_CHORES)
    .map((chore, index) => {
      source("chore", chore, index, chore.title, {
        dependencies: input.role === "parent" ? names : [],
      });
      return {
        title: boundedText(chore.title),
        dueDay: toDateOnlyUTC(chore.due_date),
        status: statusFor(chore.status),
        assignee:
          input.role === "parent"
            ? boundedText(
                (chore.assigned_to
                  ? namesById.get(chore.assigned_to)
                  : undefined) ?? "A household member",
              )
            : "You",
      };
    });

  const dinnerRow = dinnerRows.find(
    (dinner) => toDateOnlyUTC(dinner.date) === localDate,
  );
  const linkedRecipe =
    dinnerRow?.recipe?.family_id === input.familyId ? dinnerRow.recipe : null;
  if (dinnerRow)
    source(
      "dinner",
      dinnerRow,
      0,
      linkedRecipe?.title || dinnerRow.recipe_name || "Dinner",
    );
  const dinner: AssistantTodayDinner | null = dinnerRow
    ? {
        title:
          boundedText(linkedRecipe?.title || dinnerRow.recipe_name) || null,
        cook: dinnerRow.cook
          ? input.role === "parent"
            ? dinnerRow.cook.family_id === input.familyId
              ? boundedText(dinnerRow.cook.name)
              : "A household member"
            : dinnerRow.cook.id === input.userId &&
                dinnerRow.cook.family_id === input.familyId
              ? "You"
              : "Another household member"
          : null,
        prepMinutes:
          typeof linkedRecipe?.prep_time === "number" &&
          Number.isFinite(linkedRecipe.prep_time)
            ? linkedRecipe.prep_time
            : null,
      }
    : null;

  const groceries: AssistantTodayGrocery[] = groceryRows.map((item, index) => {
    source("grocery", item, index, item.content, { containerId: item.list.id });
    return {
      item: boundedText(item.content),
      quantity:
        Number.isSafeInteger(item.quantity) && item.quantity > 0
          ? item.quantity
          : 1,
      list: boundedText(item.list.name),
    };
  });

  let useSoonIndex = 0;
  const useSoon: AssistantTodayUseSoon[] = useSoonRows.flatMap((item) => {
    if (!item.expires_on) return [];
    const dateKind = asDateKind(item.date_kind);
    const expiry = expiryStatus(
      item.expires_on,
      dateStart,
      DEFAULT_USE_SOON_DAYS,
      dateKind,
    );
    if (!isUseSoonStatus(expiry.status) || expiry.daysLeft === null) return [];
    source("inventory", item, useSoonIndex++, item.name);
    return [
      {
        item: boundedText(item.name),
        place: safePlace(item.location),
        expiresOn: toDateOnlyUTC(item.expires_on),
        dateKind,
        status: expiry.status,
        label: expiryLabel(expiry.status, expiry.daysLeft, dateKind),
      },
    ];
  });

  input.onSources?.(sources);
  return { events, chores, dinner, groceries, useSoon };
}
