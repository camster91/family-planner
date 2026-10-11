// Dormant name-only household profile HTTP surface (#480): parent person
// sessions may manage presentation profiles, while account-backed members and
// shared-device capabilities remain separate. These are route-contract tests;
// the command's PostgreSQL transaction/replay suite lives with its service.
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock(
  "next/headers",
  () => require("@/__tests__/helpers/two-household").nextHeadersMock,
);
jest.mock(
  "@/lib/session",
  () => require("@/__tests__/helpers/two-household").sessionMock,
);
jest.mock("@/lib/prisma", () => ({
  prisma: require("@/__tests__/helpers/two-household").fakePrisma,
}));
jest.mock("@/lib/device-route", () => ({
  refusePairedDevice: jest.fn(async () => null),
}));
jest.mock("@/lib/household-profile-management", () => {
  const actual = jest.requireActual("@/lib/household-profile-management");
  return { ...actual, manageHouseholdProfile: jest.fn() };
});

import { GET, POST as createProfile } from "../route";
import { PATCH } from "../[id]/route";
import { POST as archiveProfile } from "../[id]/archive/route";
import {
  FAMILY_A,
  FAMILY_B,
  USER_IDS,
  bodyOf,
  db,
  req,
  params,
  fakePrisma,
  type UserKey,
} from "@/__tests__/helpers/two-household";
import {
  manageHouseholdProfile,
  HouseholdProfileError,
} from "@/lib/household-profile-management";
import { refusePairedDevice } from "@/lib/device-route";
import { NextResponse } from "next/server";
import { PROFILE_SETUP_UNSUPPORTED_CODE } from "@/lib/household-profile-http";

const manage = manageHouseholdProfile as jest.Mock;
const refuse = refusePairedDevice as jest.Mock;
const KEY = "profile-request-0001";
const initialProfileSetupEnabled = process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED;

function profile(id: string, family_id: string, name = "Toddler") {
  return {
    id,
    family_id,
    name,
    role: "child",
    age: 3,
    archived_at: null,
    revision: 0,
  };
}

function keyed(as: UserKey, body: unknown, path = "/api/family/profiles") {
  return req({
    as,
    method: "POST",
    path,
    body,
    headers: { "Idempotency-Key": KEY },
  });
}

beforeEach(() => {
  process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED = "1";
  db.reset();
  manage.mockReset();
  refuse.mockReset().mockResolvedValue(null);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  if (initialProfileSetupEnabled === undefined)
    delete process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED;
  else process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED = initialProfileSetupEnabled;
  jest.restoreAllMocks();
});

async function withProfileSetupValue<T>(
  value: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED;
  if (value === undefined) delete process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED;
  else process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined)
      delete process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED;
    else process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED = previous;
  }
}

describe("GET /api/family/profiles", () => {
  it("returns stable unsupported capability before list or mutation unless exactly opted in", async () => {
    const findMany = jest.spyOn(fakePrisma.householdMember, "findMany");
    for (const value of [undefined, "0"]) {
      await withProfileSetupValue(value, async () => {
        const read = await GET(
          req({ as: "parentA", path: "/api/family/profiles" }),
        );
        expect(read.status).toBe(409);
        expect(read.headers.get("Cache-Control")).toBe("private, no-store");
        expect((await bodyOf(read)).error).toMatchObject({
          code: PROFILE_SETUP_UNSUPPORTED_CODE,
          retryable: false,
        });
        expect(findMany).not.toHaveBeenCalled();

        const write = await createProfile(
          keyed("parentA", { name: "No write while dormant" }),
        );
        expect(write.status).toBe(409);
        expect(write.headers.get("Cache-Control")).toBe("private, no-store");
        expect((await bodyOf(write)).error).toMatchObject({
          code: PROFILE_SETUP_UNSUPPORTED_CODE,
          retryable: false,
        });
        expect(manage).not.toHaveBeenCalled();
        expect(db.writes).toHaveLength(0);
      });
    }
  });

  it("requires the explicit server opt-in for an enabled route contract", async () => {
    manage.mockResolvedValueOnce({
      profile: profile("new-profile", FAMILY_A),
      replayed: false,
    });
    const response = await createProfile(
      keyed("parentA", { name: "Enabled child" }),
    );
    expect(response.status).toBe(201);
    expect(manage).toHaveBeenCalledTimes(1);
  });

  it("returns only the current household and a strict public DTO", async () => {
    db.rows("householdMember").push(
      profile("profile-a-active-alpha", FAMILY_A, "Aaron"),
      profile("profile-a", FAMILY_A),
      {
        ...profile("profile-a-archived", FAMILY_A, "Old child"),
        archived_at: new Date("2026-09-02T00:00:00Z"),
        revision: 2,
      },
      {
        ...profile("profile-a-archived-alpha", FAMILY_A, "Aaron"),
        archived_at: new Date("2026-09-02T00:00:00Z"),
        revision: 2,
      },
      profile("profile-a-linked", FAMILY_A, "Linked account"),
      profile("profile-a-mapped", FAMILY_A, "Legacy account"),
      {
        ...profile("profile-a-erased", FAMILY_A, "Erased account"),
        erasure_user_id: "child-a",
      },
      {
        ...profile("profile-b", FAMILY_B, `Child ${"FOREIGN"}`),
        email: "private@example.test",
        account_link: { user_id: "secret-b" },
      },
    );
    db.rows("householdMemberAccountLink").push({
      member_id: "profile-a-linked",
      user_id: "child-a",
      family_id: FAMILY_A,
      verified_at: new Date("2026-09-02T00:00:00Z"),
    });
    db.rows("householdMemberLegacyMapping").push({
      member_id: "profile-a-mapped",
      user_id: "teen-a",
      family_id: FAMILY_A,
    });
    const findMany = jest.spyOn(fakePrisma.householdMember, "findMany");

    const response = await GET(
      req({ as: "parentA", path: "/api/family/profiles" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await bodyOf(response);
    expect(body.profiles).toHaveLength(4);
    expect(body.profiles.map((item: { id: string }) => item.id)).toEqual([
      "profile-a-active-alpha",
      "profile-a",
      "profile-a-archived-alpha",
      "profile-a-archived",
    ]);
    expect(Object.keys(body.profiles[0]).sort()).toEqual([
      "age",
      "archived_at",
      "family_id",
      "id",
      "name",
      "revision",
      "role",
    ]);
    expect(JSON.stringify(body)).not.toContain(FAMILY_B);
    expect(JSON.stringify(body)).not.toContain("FOREIGN");
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(body.profiles[1]).toEqual(profile("profile-a", FAMILY_A));
    expect(body.profiles[2].archived_at).toBe("2026-09-02T00:00:00.000Z");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          family_id: FAMILY_A,
          legacy_mapping: { is: null },
          account_link: { is: null },
          erasure_user_id: null,
        },
        orderBy: [
          { archived_at: { sort: "asc", nulls: "first" } },
          { name: "asc" },
          { id: "asc" },
        ],
      }),
    );
  });

  it("fails closed when a stored profile role is outside the presentation enum", async () => {
    db.rows("householdMember").push({
      ...profile("profile-invalid", FAMILY_A, "Unknown role"),
      role: "owner",
    });
    const response = await GET(
      req({ as: "parentA", path: "/api/family/profiles" }),
    );
    expect(response.status).toBe(500);
    const body = await bodyOf(response);
    expect(body.error.code).toBe("PROFILE_STORAGE_INVALID");
    expect(JSON.stringify(body)).not.toContain("owner");
  });

  it.each(["teenA", "childA", "childB"] as UserKey[])(
    "%s cannot read profiles",
    async (as) => {
      const response = await GET(req({ as, path: "/api/family/profiles" }));
      expect(response.status).toBe(403);
      expect(db.writes).toHaveLength(0);
    },
  );

  it("keeps normal authentication and household failures distinct", async () => {
    expect((await GET(req({ as: null }))).status).toBe(401);
    expect((await GET(req({ as: "loner" }))).status).toBe(400);
    expect((await GET(req({ as: "parentB" }))).status).toBe(200);
  });

  it("refuses a paired tablet before any person auth or profile read", async () => {
    refuse.mockResolvedValueOnce(
      NextResponse.json(
        { error: { code: "DEVICE_WRITE_NOT_ALLOWED" } },
        { status: 403 },
      ),
    );
    const response = await GET(
      req({ as: "parentA", path: "/api/family/profiles" }),
    );
    expect(response.status).toBe(403);
    expect(refuse).toHaveBeenCalledTimes(1);
    expect(db.writes).toHaveLength(0);
  });
});

describe("profile mutations", () => {
  it("requires a parent person session and required idempotency key before invoking the command", async () => {
    expect(
      (await createProfile(req({ as: "parentA", body: { name: "No key" } })))
        .status,
    ).toBe(400);
    expect(manage).not.toHaveBeenCalled();
    expect(
      (
        await createProfile(
          req({
            as: "teenA",
            body: { name: "Teen" },
            headers: { "Idempotency-Key": KEY },
          }),
        )
      ).status,
    ).toBe(403);
    expect(manage).not.toHaveBeenCalled();
    const malformed = await createProfile(
      req({
        as: "parentA",
        body: { name: "Bad" },
        headers: { "Idempotency-Key": "too-short" },
      }),
    );
    expect(malformed.status).toBe(400);
    expect((await bodyOf(malformed)).error.code).toBe(
      "IDEMPOTENCY_KEY_INVALID",
    );
  });

  it("passes only the authenticated actor and canonical create command to the transaction owner", async () => {
    manage.mockResolvedValueOnce({
      profile: profile("new-profile", FAMILY_A, "Baby"),
      replayed: false,
    });
    const response = await createProfile(
      keyed("parentA", { name: "Baby", role: "child", age: 2 }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await bodyOf(response)).toEqual({
      profile: profile("new-profile", FAMILY_A, "Baby"),
    });
    expect(manage).toHaveBeenCalledWith(
      expect.anything(),
      { userId: USER_IDS.parentA, familyId: FAMILY_A, tokenVersion: 0 },
      KEY,
      { action: "create", name: "Baby", role: "child", age: 2 },
    );

    manage.mockResolvedValueOnce({
      profile: profile("new-profile-b", FAMILY_B),
      replayed: false,
    });
    await createProfile(keyed("parentB", { name: "Baby B" }));
    expect(manage).toHaveBeenLastCalledWith(
      expect.anything(),
      { userId: USER_IDS.parentB, familyId: FAMILY_B, tokenVersion: 0 },
      KEY,
      { action: "create", name: "Baby B", role: "child" },
    );
  });

  it("returns the command replay with the replay header and no second wrapper", async () => {
    manage.mockResolvedValueOnce({
      profile: profile("new-profile", FAMILY_A),
      replayed: true,
    });
    const response = await createProfile(keyed("parentA", { name: "Toddler" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps edit and archive ids route-owned and preserves the command error contract", async () => {
    manage.mockResolvedValueOnce({
      profile: {
        ...profile("profile-a", FAMILY_A),
        name: "Updated",
        revision: 1,
      },
      replayed: false,
    });
    const edited = await PATCH(
      req({
        as: "parentA",
        method: "PATCH",
        body: { name: "Updated", revision: 0 },
        headers: { "Idempotency-Key": KEY },
      }),
      params({ id: "profile-a" }),
    );
    expect(edited.status).toBe(200);
    expect(manage).toHaveBeenLastCalledWith(
      expect.anything(),
      { userId: USER_IDS.parentA, familyId: FAMILY_A, tokenVersion: 0 },
      KEY,
      { action: "edit", id: "profile-a", name: "Updated", revision: 0 },
    );

    manage.mockRejectedValueOnce(new HouseholdProfileError("CONFLICT"));
    const archived = await archiveProfile(
      req({
        as: "parentA",
        method: "POST",
        body: { revision: 1 },
        headers: { "Idempotency-Key": "profile-archive-0001" },
      }),
      params({ id: "profile-a" }),
    );
    expect(archived.status).toBe(409);
    expect((await bodyOf(archived)).error.code).toBe("PROFILE_CONFLICT");
    expect(archived.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each([
    [
      "create",
      createProfile,
      req({
        as: "parentA",
        body: { name: "x", email: "leak@example.test" },
        headers: { "Idempotency-Key": KEY },
      }),
    ],
    [
      "edit",
      PATCH,
      req({
        as: "parentA",
        method: "PATCH",
        body: { name: "x", revision: 0, family_id: FAMILY_B },
        headers: { "Idempotency-Key": KEY },
      }),
    ],
    [
      "archive",
      archiveProfile,
      req({
        as: "parentA",
        method: "POST",
        body: { revision: 0, email: "leak@example.test" },
        headers: { "Idempotency-Key": KEY },
      }),
    ],
  ] as const)(
    "%s rejects account/family fields before any pending write",
    async (kind, handler, request) => {
      const response =
        kind === "create"
          ? await handler(request as any)
          : await handler(request as any, params({ id: "profile-a" }));
      expect(response.status).toBe(400);
      expect(manage).not.toHaveBeenCalled();
      expect(db.writes).toHaveLength(0);
    },
  );

  it("maps key reuse to the stable idempotency error without exposing command details", async () => {
    manage.mockRejectedValueOnce(new HouseholdProfileError("KEY_REUSED"));
    const response = await createProfile(keyed("parentA", { name: "Baby" }));
    expect(response.status).toBe(422);
    expect((await bodyOf(response)).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(JSON.stringify(await bodyOf(response))).not.toContain("profile");
  });
});
