import { fetchHouseholdProfiles } from "../household-profile-client";

const profile = {
  id: "profile-jamie",
  name: "Jamie",
  role: "child" as const,
  age: null,
  archived_at: null,
  revision: 0,
};

function response(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

describe("household profile client", () => {
  it("fails closed for an older profile response without recurrence capability", async () => {
    await expect(
      fetchHouseholdProfiles(async () =>
        response({ profiles: [profile], profileChoreSupported: true }),
      ),
    ).resolves.toEqual({
      profiles: [profile],
      profileChoreSupported: true,
    });
  });

  it("reads the private recurrence capability only when the response advertises it", async () => {
    await expect(
      fetchHouseholdProfiles(async () =>
        response({
          profiles: [profile],
          profileChoreSupported: true,
          profileChoreRecurrenceSupported: true,
        }),
      ),
    ).resolves.toEqual({
      profiles: [profile],
      profileChoreSupported: true,
      profileChoreRecurrenceSupported: true,
    });
  });

  it("returns no capability on HTTP, network, or malformed responses", async () => {
    await expect(
      fetchHouseholdProfiles(async () => response({}, false)),
    ).resolves.toBeNull();
    await expect(
      fetchHouseholdProfiles(async () => {
        throw new Error("offline");
      }),
    ).resolves.toBeNull();
    await expect(
      fetchHouseholdProfiles(async () => response({ profiles: "not-an-array" })),
    ).resolves.toBeNull();
  });
});
