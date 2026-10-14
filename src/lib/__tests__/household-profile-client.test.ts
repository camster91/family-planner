import {
  fetchHouseholdProfiles,
  readProfileChoreCreateSuccess,
} from "../household-profile-client";

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
  const validChore = {
    id: "chore-1",
    title: "Pack a bag",
    description: null,
    due_date: "2099-10-05",
    status: "pending",
    frequency: "once",
    weekly_days: [],
    recurrence_id: null,
    is_template: false,
    difficulty: "medium",
    icon: null,
    routine: null,
    routine_order: null,
    subject: {
      kind: "profile",
      memberId: "profile-jamie",
      name: "Jamie",
      role: "child",
    },
    created_at: "2026-10-14T16:00:00.000Z",
  } as const;

  it("accepts the canonical profile create response and additive fields", () => {
    expect(
      readProfileChoreCreateSuccess({
        chore: { ...validChore, server_hint: "safe to ignore" },
        trace_id: "request-1",
      }),
    ).toEqual({ chore: validChore });
  });

  it("rejects a malformed or identity-incomplete profile create response", () => {
    expect(readProfileChoreCreateSuccess({ chore: { id: "chore-1" } })).toBeNull();
    expect(
      readProfileChoreCreateSuccess({
        chore: {
          ...validChore,
          subject: { ...validChore.subject, kind: "account" },
        },
      }),
    ).toBeNull();
    expect(
      readProfileChoreCreateSuccess({
        chore: { ...validChore, weekly_days: [1] },
      }),
    ).toBeNull();
    expect(
      readProfileChoreCreateSuccess(
        { chore: validChore },
        "profile-other",
      ),
    ).toBeNull();
  });

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
