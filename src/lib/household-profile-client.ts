import {
  readHouseholdProfilesResponse,
  type HouseholdProfilesResponse,
} from "@/lib/household-profile-types";

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
