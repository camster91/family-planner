export type HouseholdProfileRole = "child" | "teen" | "parent";

export type HouseholdProfile = {
  id: string;
  name: string;
  role: HouseholdProfileRole;
  age: number | null;
  archived_at: string | null;
  revision: number;
};

export type HouseholdProfilesResponse = {
  profiles: HouseholdProfile[];
  profileChoreSupported: boolean;
  profileChoreRecurrenceSupported?: boolean;
};

export function isHouseholdProfile(value: unknown): value is HouseholdProfile {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    item.name.trim().length > 0 &&
    (item.role === "child" || item.role === "teen" || item.role === "parent") &&
    (item.age === null || (typeof item.age === "number" && Number.isInteger(item.age))) &&
    (item.archived_at === null || typeof item.archived_at === "string") &&
    typeof item.revision === "number" &&
    Number.isInteger(item.revision)
  );
}

export function readHouseholdProfilesResponse(
  value: unknown,
): HouseholdProfilesResponse | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as {
    profiles?: unknown;
    profileChoreSupported?: unknown;
    profileChoreRecurrenceSupported?: unknown;
  };
  const profiles = payload.profiles;
  if (!Array.isArray(profiles) || !profiles.every(isHouseholdProfile)) return null;
  if (
    payload.profileChoreSupported !== undefined &&
    typeof payload.profileChoreSupported !== "boolean"
  )
    return null;
  if (
    payload.profileChoreRecurrenceSupported !== undefined &&
    typeof payload.profileChoreRecurrenceSupported !== "boolean"
  )
    return null;
  return {
    profiles,
    profileChoreSupported: payload.profileChoreSupported === true,
    ...(payload.profileChoreRecurrenceSupported === true
      ? { profileChoreRecurrenceSupported: true }
      : {}),
  };
}

export function readHouseholdProfiles(value: unknown): HouseholdProfile[] | null {
  return readHouseholdProfilesResponse(value)?.profiles ?? null;
}

export function findActiveHouseholdProfile(
  profiles: HouseholdProfile[],
  id: string,
): HouseholdProfile | null {
  return profiles.find((profile) => profile.id === id && !profile.archived_at) ?? null;
}

export function readApiErrorCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const error = (value as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
