/**
 * Narrow, server-only Today reads for the dormant Family AI broker.
 *
 * This loader intentionally does not reuse the visual Today board. The board
 * also loads display settings, ambient photos and optional weather, while a
 * provider context needs only a small allowlisted set of rows. Nothing in the
 * return type contains a record or member id.
 */
import type { PrismaClient } from "@prisma/client";
import { addUTCDays, startOfTodayUTC, toDateOnlyUTC } from "@/lib/dates";
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
const QUERY_DAYS_AFTER_TODAY = 4;

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

function eventIsOnLocalDay(
  event: { start_time: Date; end_time: Date },
  localDate: string,
  timeZone: string,
  now: Date,
): boolean {
  return (
    localDateFor(event.start_time, timeZone) === localDate ||
    localDateFor(event.end_time, timeZone) === localDate ||
    (event.start_time.getTime() <= now.getTime() &&
      event.end_time.getTime() > now.getTime())
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

function safeDateKind(
  value: string | null | undefined,
): "best_before" | "use_by" {
  return value === "use_by" ? "use_by" : "best_before";
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
  const localDate = localDateFor(input.serverNow, input.viewerTimeZone);
  const dayStart = startOfTodayUTC(input.serverNow);
  const queryStart = addUTCDays(dayStart, -1);
  const queryEnd = addUTCDays(dayStart, QUERY_DAYS_AFTER_TODAY);

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
          end_time: { gt: input.serverNow },
          start_time: { lt: queryEnd },
        },
        select: {
          title: true,
          start_time: true,
          end_time: true,
          is_task: true,
          // Presence supplies a fixed source label. The arbitrary source name
          // never enters the projection, and no source id is selected.
          source_subscription: { select: { name: true } },
          source_connection: { select: { calendar_name: true } },
        },
        orderBy: [{ start_time: "asc" }],
        take: MAX_EVENTS * 3,
      })
    : Promise.resolve([]);

  const choresPromise = input.features.chores
    ? db.chore.findMany({
        where: {
          family_id: input.familyId,
          due_date: { gte: queryStart, lt: queryEnd },
          ...(input.role === "teen" ? { assigned_to: input.userId } : {}),
        },
        select: {
          title: true,
          due_date: true,
          status: true,
          assigned_to: true,
        },
        orderBy: [{ due_date: "asc" }, { created_at: "asc" }],
        take: input.role === "teen" ? MAX_CHORES : MAX_CHORES * 2,
      })
    : Promise.resolve([]);

  const dinnersPromise = input.features.meals
    ? db.familyMeal.findMany({
        where: {
          family_id: input.familyId,
          meal_type: "dinner",
          date: { gte: queryStart, lt: queryEnd },
        },
        select: {
          date: true,
          recipe_name: true,
          cook: { select: { id: true, name: true, family_id: true } },
          recipe: { select: { title: true, prep_time: true } },
        },
        orderBy: [{ date: "asc" }, { created_at: "asc" }],
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
          content: true,
          quantity: true,
          list: { select: { name: true } },
        },
        orderBy: [{ created_at: "asc" }],
        take: MAX_GROCERIES,
      })
    : Promise.resolve([]);

  const useSoonPromise = input.features.inventory
    ? db.inventoryItem.findMany({
        where: {
          family_id: input.familyId,
          status: "active",
          expires_on: { not: null, lte: addUTCDays(dayStart, 4) },
          OR: [
            { date_kind: { not: "use_by" } },
            { expires_on: { gte: queryStart } },
          ],
        },
        select: {
          name: true,
          location: true,
          expires_on: true,
          date_kind: true,
        },
        orderBy: [{ expires_on: "asc" }, { name: "asc" }],
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
    .filter((event) =>
      eventIsOnLocalDay(
        event,
        localDate,
        input.viewerTimeZone,
        input.serverNow,
      ),
    )
    .slice(0, MAX_EVENTS)
    .map((event) => ({
      title: boundedText(event.title),
      localStart: localDateTimeFor(event.start_time, input.viewerTimeZone),
      localEnd: localDateTimeFor(event.end_time, input.viewerTimeZone),
      isTask: event.is_task,
      source: event.source_subscription
        ? "Subscribed calendar"
        : event.source_connection
          ? "Connected calendar"
          : null,
    }));

  const chores: AssistantTodayChore[] = choreRows
    .filter(
      (chore) => input.role === "parent" || chore.assigned_to === input.userId,
    )
    .filter((chore) => toDateOnlyUTC(chore.due_date) === localDate)
    .slice(0, MAX_CHORES)
    .map((chore) => ({
      title: boundedText(chore.title),
      dueDay: toDateOnlyUTC(chore.due_date),
      status: statusFor(chore.status),
      assignee:
        input.role === "parent"
          ? boundedText(
              namesById.get(chore.assigned_to) ?? "A household member",
            )
          : "You",
    }));

  const dinnerRow = dinnerRows.find(
    (dinner) => toDateOnlyUTC(dinner.date) === localDate,
  );
  const dinner: AssistantTodayDinner | null = dinnerRow
    ? {
        title:
          boundedText(dinnerRow.recipe?.title || dinnerRow.recipe_name) || null,
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
          typeof dinnerRow.recipe?.prep_time === "number" &&
          Number.isFinite(dinnerRow.recipe.prep_time)
            ? dinnerRow.recipe.prep_time
            : null,
      }
    : null;

  const groceries: AssistantTodayGrocery[] = groceryRows.map((item) => ({
    item: boundedText(item.content),
    quantity:
      Number.isSafeInteger(item.quantity) && item.quantity > 0
        ? item.quantity
        : 1,
    list: boundedText(item.list.name),
  }));

  const useSoon: AssistantTodayUseSoon[] = useSoonRows.flatMap((item) =>
    item.expires_on
      ? [
          {
            item: boundedText(item.name),
            place: safePlace(item.location),
            expiresOn: toDateOnlyUTC(item.expires_on),
            dateKind: safeDateKind(item.date_kind),
          },
        ]
      : [],
  );

  return { events, chores, dinner, groceries, useSoon };
}
