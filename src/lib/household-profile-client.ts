import {
  readHouseholdProfilesResponse,
  type HouseholdProfilesResponse,
} from "@/lib/household-profile-types";

export type ProfileChoreCreateSuccess = {
  chore: {
    id: string;
    title: string;
    description: string | null;
    due_date: string;
    status: string;
    frequency: "once" | "daily" | "weekly" | "monthly";
    weekly_days: number[];
    recurrence_id: string | null;
    is_template: boolean;
    difficulty: "easy" | "medium" | "hard";
    icon: string | null;
    routine: string | null;
    routine_order: number | null;
    subject: {
      kind: "profile";
      memberId: string;
      name: string;
      role: "child" | "teen" | "parent";
    };
    created_at: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasRequiredKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isDateString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

const memberIdentityIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function isProfileSubject(
  value: unknown,
): value is ProfileChoreCreateSuccess["chore"]["subject"] {
  if (
    !isRecord(value) ||
    !hasRequiredKeys(value, ["kind", "memberId", "name", "role"])
  )
    return false;
  return (
    value.kind === "profile" &&
    typeof value.memberId === "string" &&
    memberIdentityIdPattern.test(value.memberId) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    (value.role === "child" || value.role === "teen" || value.role === "parent")
  );
}

/**
 * Validate the canonical protocol-2 profile-create response before treating a
 * 2xx as committed. A lost or malformed response must leave the keyed draft
 * retryable; accepting `{}` here would clear the key and navigate away.
 */
export function readProfileChoreCreateSuccess(
  value: unknown,
  expectedMemberId?: string,
): ProfileChoreCreateSuccess | null {
  if (!isRecord(value) || !hasRequiredKeys(value, ["chore"])) return null;
  const chore = value.chore;
  if (
    !isRecord(chore) ||
    !hasRequiredKeys(chore, [
      "id",
      "title",
      "description",
      "due_date",
      "status",
      "frequency",
      "weekly_days",
      "recurrence_id",
      "is_template",
      "difficulty",
      "icon",
      "routine",
      "routine_order",
      "subject",
      "created_at",
    ])
  )
    return null;
  if (
    typeof chore.id !== "string" ||
    chore.id.length === 0 ||
    typeof chore.title !== "string" ||
    chore.title.trim().length === 0 ||
    (chore.description !== null && typeof chore.description !== "string") ||
    !isDateString(chore.due_date) ||
    typeof chore.status !== "string" ||
    chore.status.length === 0 ||
    !["once", "daily", "weekly", "monthly"].includes(
      chore.frequency as string,
    ) ||
    !Array.isArray(chore.weekly_days) ||
    chore.weekly_days.some(
      (day) =>
        typeof day !== "number" ||
        !Number.isInteger(day) ||
        day < 0 ||
        day > 6,
    ) ||
    new Set(chore.weekly_days).size !== chore.weekly_days.length ||
    (chore.recurrence_id !== null && typeof chore.recurrence_id !== "string") ||
    typeof chore.is_template !== "boolean" ||
    !["easy", "medium", "hard"].includes(chore.difficulty as string) ||
    (chore.icon !== null && typeof chore.icon !== "string") ||
    (chore.routine !== null && typeof chore.routine !== "string") ||
    (chore.routine_order !== null &&
      (typeof chore.routine_order !== "number" ||
        !Number.isInteger(chore.routine_order))) ||
    !isProfileSubject(chore.subject) ||
    !isDateString(chore.created_at)
  )
    return null;
  if (
    expectedMemberId !== undefined &&
    chore.subject.memberId !== expectedMemberId
  )
    return null;
  if (chore.frequency === "weekly") {
    if (chore.weekly_days.length === 0) return null;
  } else if (chore.weekly_days.length > 0) {
    return null;
  }
  if (chore.frequency === "once") {
    if (chore.recurrence_id !== null || chore.is_template) return null;
  } else if (chore.recurrence_id === null || !chore.is_template) {
    return null;
  }
  return {
    chore: {
      id: chore.id,
      title: chore.title,
      description: chore.description,
      due_date: chore.due_date,
      status: chore.status,
      frequency: chore.frequency,
      weekly_days: chore.weekly_days,
      recurrence_id: chore.recurrence_id,
      is_template: chore.is_template,
      difficulty: chore.difficulty,
      icon: chore.icon,
      routine: chore.routine,
      routine_order: chore.routine_order,
      subject: {
        kind: "profile",
        memberId: chore.subject.memberId,
        name: chore.subject.name,
        role: chore.subject.role,
      },
      created_at: chore.created_at,
    },
  } as ProfileChoreCreateSuccess;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Read the optional profile roster and its private writer capabilities.
 * Older servers omit the recurrence field; the existing parser intentionally
 * returns that as unsupported so a client never invents profile recurrence.
 */
export async function fetchHouseholdProfiles(
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<HouseholdProfilesResponse | null> {
  let response: Response;
  try {
    response = await fetchImpl("/api/family/profiles", { cache: "no-store" });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return readHouseholdProfilesResponse(payload);
}
