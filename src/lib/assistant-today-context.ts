/**
 * Dormant, server-only Today context for Family AI.
 *
 * This module deliberately stops at a typed projection. It does not call a
 * provider, expose a route, execute an action, or read from a shared-device
 * session. A future assistant route must perform its normal person/device
 * authentication first and pass the authoritative actor claims here.
 */
import type { PrismaClient } from "@prisma/client";
import { loadTodayBoard } from "@/app/dashboard/today/board-snapshot";
import {
  effectiveFeatures,
  normalizeFeatures,
  type FeatureKey,
} from "@/lib/features";
import { isValidTimeZone } from "@/lib/quiet-hours";
import type { TodayBoardData } from "@/app/dashboard/today/today-board-data";

export const ASSISTANT_TODAY_PROTOCOL = "herewoven.assistant-today.v1" as const;
export const ASSISTANT_TODAY_TTL_MS = 60_000;
export const ASSISTANT_TODAY_MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

const MAX_EVENTS = 20;
const MAX_CHORES = 30;
const MAX_GROCERIES = 20;
const MAX_USE_SOON = 20;
const MAX_TEXT_BYTES = 512;
const MAX_SOURCE_BYTES = 128;

const ASSISTANT_ROLES = ["parent", "teen"] as const;
type AssistantRole = (typeof ASSISTANT_ROLES)[number];

/** Fixed status vocabulary; arbitrary database status text never reaches a provider. */
export type AssistantTodayStatus =
  "open" | "in_progress" | "done" | "overdue" | "unknown";

export interface AssistantTodayEvent {
  title: string;
  localStart: string;
  localEnd: string;
  isTask: boolean;
  source: string | null;
}

export interface AssistantTodayChore {
  title: string;
  dueDay: string;
  status: AssistantTodayStatus;
  assignee: string;
}

export interface AssistantTodayDinner {
  title: string | null;
  cook: string | null;
  prepMinutes: number | null;
}

export interface AssistantTodayGrocery {
  item: string;
  quantity: number;
  list: string;
}

export interface AssistantTodayUseSoon {
  item: string;
  place: string;
  expiresOn: string;
  dateKind: "best_before" | "use_by";
}

export interface AssistantTodayWeather {
  unit: "C" | "F";
  current: {
    temperature: number;
    summary: string;
    icon: string;
    isDay: boolean;
  };
  days: Array<{
    day: string;
    high: number;
    low: number;
    summary: string;
    icon: string;
    precipitationChance: number | null;
  }>;
  fetchedAt: string;
}

export type AssistantTodayUnavailableSection =
  "dinner" | "groceries" | "useSoon" | "weather";

export interface AssistantTodayContext {
  protocol: typeof ASSISTANT_TODAY_PROTOCOL;
  generatedAt: string;
  expiresAt: string;
  viewer: {
    role: AssistantRole;
    localDate: string;
    timeZone: string;
  };
  today: {
    events: AssistantTodayEvent[];
    chores: AssistantTodayChore[];
    dinner: AssistantTodayDinner | null;
    groceries: AssistantTodayGrocery[];
    useSoon: AssistantTodayUseSoon[];
    weather: AssistantTodayWeather | null;
    /** Feature-off sections are explicit so [] never means an uncertain read. */
    unavailable: AssistantTodayUnavailableSection[];
  };
}

export interface LoadAssistantTodayContextInput {
  /** Must come from the already-authenticated person session. */
  userId: string;
  /** An expected family claim; the current User row remains authoritative. */
  familyId: string;
  /** An expected role claim; the current User row remains authoritative. */
  role: string;
  serverNow: Date;
  viewerTimeZone: string;
  /** Advisory only. It is rejected when more than 24 hours from serverNow. */
  localNow?: Date;
  /** A paired/shared device can never use the person assistant broker. */
  surface?: "person" | "paired-device";
}

export type AssistantTodayDb = Pick<
  PrismaClient,
  | "user"
  | "family"
  | "event"
  | "chore"
  | "familyMeal"
  | "calendarSubscription"
  | "listItem"
  | "list"
  | "inventoryItem"
  | "weatherCache"
  | "upload"
>;

export class AssistantTodayInputError extends Error {
  readonly code: "INVALID_TIME_ZONE" | "INVALID_CLOCK" | "INVALID_SERVER_TIME";

  constructor(code: AssistantTodayInputError["code"]) {
    super(code);
    this.name = "AssistantTodayInputError";
    this.code = code;
  }
}

function assertInput(input: LoadAssistantTodayContextInput): void {
  if (
    !(input.serverNow instanceof Date) ||
    !Number.isFinite(input.serverNow.getTime())
  ) {
    throw new AssistantTodayInputError("INVALID_SERVER_TIME");
  }
  if (!isValidTimeZone(input.viewerTimeZone)) {
    throw new AssistantTodayInputError("INVALID_TIME_ZONE");
  }
  if (input.localNow !== undefined) {
    if (
      !(input.localNow instanceof Date) ||
      !Number.isFinite(input.localNow.getTime())
    ) {
      throw new AssistantTodayInputError("INVALID_CLOCK");
    }
    if (
      Math.abs(input.localNow.getTime() - input.serverNow.getTime()) >
      ASSISTANT_TODAY_MAX_CLOCK_SKEW_MS
    ) {
      throw new AssistantTodayInputError("INVALID_CLOCK");
    }
  }
}

function partsFor(date: Date, timeZone: string): Record<string, string> {
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
  const parts = partsFor(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Local wall time is intentionally a display value, not a new instant. */
function localDateTimeFor(date: Date, timeZone: string): string {
  const parts = partsFor(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
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
  const source = boundedText(value, MAX_SOURCE_BYTES).trim();
  return source || null;
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

function roleLabel(
  role: AssistantRole,
  assigneeId: string,
  viewerId: string,
  nameById: Map<string, string>,
): string {
  if (role === "parent")
    return boundedText(nameById.get(assigneeId) ?? "A household member");
  return assigneeId === viewerId ? "You" : "Another household member";
}

function eventIsOnLocalDay(
  event: TodayBoardData["events"][number],
  localDate: string,
  timeZone: string,
  now: Date,
): boolean {
  const start = new Date(event.start);
  const end = new Date(event.end);
  return (
    localDateFor(start, timeZone) === localDate ||
    localDateFor(end, timeZone) === localDate ||
    (start.getTime() <= now.getTime() && end.getTime() > now.getTime())
  );
}

function projectWeather(board: TodayBoardData): AssistantTodayWeather | null {
  if (!board.weather) return null;
  return {
    unit: board.weather.unit,
    current: { ...board.weather.current },
    days: board.weather.days.map((day) => ({ ...day })),
    fetchedAt: board.weather.fetchedAt,
  };
}

function currentFeatureSet(raw: unknown) {
  return effectiveFeatures(normalizeFeatures(raw));
}

/**
 * Build a bounded Today-only provider projection. A null result means the
 * actor/device/household/read is unavailable; it must never be described as an
 * empty household. Database errors intentionally fail closed.
 */
export async function loadAssistantTodayContext(
  db: AssistantTodayDb,
  input: LoadAssistantTodayContextInput,
): Promise<AssistantTodayContext | null> {
  assertInput(input);

  // These are cheap, pre-database refusals for callers that already know the
  // authenticated actor. The authoritative User role is checked below too.
  if (
    input.surface === "paired-device" ||
    input.role === "child" ||
    !ASSISTANT_ROLES.includes(input.role as AssistantRole)
  ) {
    return null;
  }

  try {
    const actor = await db.user.findUnique({
      where: { id: input.userId },
      select: { id: true, family_id: true, role: true },
    });
    if (
      !actor ||
      actor.family_id !== input.familyId ||
      actor.role !== input.role ||
      !ASSISTANT_ROLES.includes(actor.role as AssistantRole)
    ) {
      return null;
    }

    const family = await db.family.findUnique({
      where: { id: actor.family_id },
      select: { id: true, features: true },
    });
    if (!family || family.id !== input.familyId) return null;

    const features = currentFeatureSet(family.features);
    const role = actor.role as AssistantRole;
    const localDate = localDateFor(input.serverNow, input.viewerTimeZone);

    // Do not request weather here: getBoardWeather may contact Open-Meteo.
    // This dormant broker has no provider or external-network side effects.
    const board = await loadTodayBoard(db, {
      familyId: family.id,
      role,
      audience: "person",
      now: input.serverNow,
      withWeather: false,
    });
    const nameById = new Map(
      board.members.map((member) => [member.id, member.name]),
    );

    const events = features.calendar
      ? board.events
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
            localStart: localDateTimeFor(
              new Date(event.start),
              input.viewerTimeZone,
            ),
            localEnd: localDateTimeFor(
              new Date(event.end),
              input.viewerTimeZone,
            ),
            isTask: event.isTask,
            source: boundedSource(event.source?.name),
          }))
      : [];

    const chores = features.chores
      ? board.chores
          .filter((chore) => chore.dueDay === localDate)
          .slice(0, MAX_CHORES)
          .map((chore) => ({
            title: boundedText(chore.title),
            dueDay: chore.dueDay,
            status: statusFor(chore.status),
            assignee: roleLabel(role, chore.assigneeId, actor.id, nameById),
          }))
      : [];

    const dinner = features.meals
      ? board.dinners?.find((meal) => meal.day === localDate)
      : undefined;
    const projectedDinner: AssistantTodayDinner | null = dinner
      ? {
          title: boundedText(dinner.recipeTitle || dinner.recipeName) || null,
          cook: dinner.cookName
            ? role === "parent"
              ? boundedText(dinner.cookName)
              : "Another household member"
            : null,
          prepMinutes:
            typeof dinner.prepMinutes === "number" &&
            Number.isFinite(dinner.prepMinutes)
              ? dinner.prepMinutes
              : null,
        }
      : null;

    const groceries = features.lists
      ? (board.shopping?.items ?? []).slice(0, MAX_GROCERIES).map((item) => ({
          item: boundedText(item.content),
          quantity:
            Number.isSafeInteger(item.quantity) && item.quantity > 0
              ? item.quantity
              : 1,
          list: boundedText(item.listName),
        }))
      : [];

    const useSoon = features.inventory
      ? (board.useSoon ?? []).slice(0, MAX_USE_SOON).map((item) => ({
          item: boundedText(item.name),
          place: boundedSource(item.location) ?? "household storage",
          expiresOn: item.expiresOn,
          dateKind:
            item.dateKind === "use_by"
              ? ("use_by" as const)
              : ("best_before" as const),
        }))
      : [];

    const unavailable: AssistantTodayUnavailableSection[] = [];
    if (!features.meals) unavailable.push("dinner");
    if (!features.lists) unavailable.push("groceries");
    if (!features.inventory) unavailable.push("useSoon");
    unavailable.push("weather");

    const generatedAt = input.serverNow.toISOString();
    return {
      protocol: ASSISTANT_TODAY_PROTOCOL,
      generatedAt,
      expiresAt: new Date(
        input.serverNow.getTime() + ASSISTANT_TODAY_TTL_MS,
      ).toISOString(),
      viewer: { role, localDate, timeZone: input.viewerTimeZone },
      today: {
        events,
        chores,
        dinner: projectedDinner,
        groceries,
        useSoon,
        weather: projectWeather(board),
        unavailable,
      },
    };
  } catch {
    return null;
  }
}

/** Keys intentionally used for gates without exposing a feature blob. */
export type AssistantTodayFeatureKey = Extract<
  FeatureKey,
  "calendar" | "chores" | "lists" | "meals" | "inventory"
>;
