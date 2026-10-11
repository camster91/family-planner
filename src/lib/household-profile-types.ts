export type HouseholdProfileRole = "child" | "teen" | "parent";

export type HouseholdProfile = {
  id: string;
  name: string;
  role: HouseholdProfileRole;
  age: number | null;
  archived_at: string | null;
  revision: number;
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

export function readHouseholdProfiles(value: unknown): HouseholdProfile[] | null {
  if (!value || typeof value !== "object") return null;
  const profiles = (value as { profiles?: unknown }).profiles;
  if (!Array.isArray(profiles) || !profiles.every(isHouseholdProfile)) return null;
  return profiles;
}

export function readApiErrorCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const error = (value as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
