import { findActiveHouseholdProfile } from "../household-profile-types";

const profile = {
  id: "profile-jamie",
  name: "Jamie",
  role: "child" as const,
  age: null,
  archived_at: null,
  revision: 0,
};

describe("household profile target resolution", () => {
  it("returns only an active profile for the explicit profile target", () => {
    expect(findActiveHouseholdProfile([profile], "profile-jamie")).toEqual(profile);
    expect(findActiveHouseholdProfile([profile], "stale-profile")).toBeNull();
    expect(
      findActiveHouseholdProfile([{ ...profile, archived_at: "2026-10-11T00:00:00.000Z" }], "profile-jamie"),
    ).toBeNull();
  });
});
