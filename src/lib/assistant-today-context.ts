import type { AssistantSourceRow } from "./assistant-references";
/**
 * Dormant, server-only Today context for Family AI.
 *
 * This module deliberately stops at a typed projection. It does not call a
 * provider, expose a route, execute an action, or read from a shared-device
 * session. A future assistant route must perform its normal person/device
 * authentication first and pass the authoritative actor claims here.
 */
import type { PrismaClient } from "@prisma/client";
import {
  effectiveFeatures,
  normalizeFeatures,
  type FeatureKey,
} from "@/lib/features";
import { isValidTimeZone } from "@/lib/quiet-hours";
import {
  loadAssistantTodayRows,
  type AssistantTodayLoaderDb,
} from "@/lib/assistant-today-loader";
import { topUpHouseholdSeries } from "@/lib/recurringChores";

export const ASSISTANT_TODAY_PROTOCOL = "herewoven.assistant-today.v1" as const;
export const ASSISTANT_TODAY_TTL_MS = 60_000;
export const ASSISTANT_TODAY_MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

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
  status: "expired" | "today" | "soon";
  label: string;
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
  /** Server-only sidecar; never included in the v1 provider projection. */
  onSources?: (sources: AssistantSourceRow[]) => void;
}

export type AssistantTodayDb = Pick<PrismaClient, "user" | "family"> &
  AssistantTodayLoaderDb;

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

function localDateFor(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
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
    // Today and Chores extend recurring series on read because generated
    // occurrences are stored as one-offs. Keep the assistant projection
    // aligned with those surfaces, but never touch a household whose Chores
    // feature is off. The helper is bounded, household-scoped and idempotent;
    // it also fails closed so an exhausted series never blocks the request.
    if (features.chores) {
      await topUpHouseholdSeries(family.id, input.serverNow);
    }
    const rows = await loadAssistantTodayRows(db, {
      familyId: family.id,
      userId: actor.id,
      role,
      features,
      serverNow: input.serverNow,
      viewerTimeZone: input.viewerTimeZone,
      onSources: input.onSources,
    });
    // Keep the capability decision at the projection boundary too. This
    // protects callers if a future loader returns a cached row after a flag
    // changes between the family read and the domain reads.
    const safeRows = {
      events: features.calendar ? rows.events : [],
      chores: features.chores ? rows.chores : [],
      dinner: features.meals ? rows.dinner : null,
      groceries: features.lists ? rows.groceries : [],
      useSoon: features.inventory ? rows.useSoon : [],
    };
    const unavailable: AssistantTodayUnavailableSection[] = [];
    if (!features.meals) unavailable.push("dinner");
    if (!features.lists) unavailable.push("groceries");
    if (!features.inventory) unavailable.push("useSoon");
    // Weather is intentionally not read by the dormant loader. This marks
    // the absent section without contacting Open-Meteo or reading coordinates.
    unavailable.push("weather");

    const generatedAt = input.serverNow.toISOString();
    return {
      protocol: ASSISTANT_TODAY_PROTOCOL,
      generatedAt,
      expiresAt: new Date(
        input.serverNow.getTime() + ASSISTANT_TODAY_TTL_MS,
      ).toISOString(),
      viewer: {
        role,
        localDate: localDateFor(input.serverNow, input.viewerTimeZone),
        timeZone: input.viewerTimeZone,
      },
      today: {
        ...safeRows,
        weather: null,
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
