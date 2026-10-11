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
jest.mock(
  "@/lib/rate-limit-db",
  () => require("@/__tests__/helpers/two-household").rateLimitMock,
);
jest.mock(
  "@/lib/notifications-server",
  () => require("@/__tests__/helpers/two-household").notificationsMock,
);

import { PATCH } from "../route";
import { POST as undo } from "../uncomplete/route";
import { POST as verify } from "../verify/route";
import { db, req } from "@/__tests__/helpers/two-household";
import * as subjects from "@/lib/chore-member-subject";
import { HouseholdMemberIdentityConflict } from "@/lib/household-member-lifecycle";

beforeEach(() => db.reset());
afterEach(() => jest.restoreAllMocks());

it.each(["edit", "undo", "reject"])(
  "%s returns identity conflict without changing canonical work",
  async (operation) => {
    const chore = db.find("chore", "chore-a")!;
    chore.assigned_member_id = "hm_fixture_child";
    chore.status = operation === "edit" ? "pending" : "completed";
    const before = structuredClone(chore);
    jest
      .spyOn(subjects, "canonicalChoreAssigneeInTx")
      .mockRejectedValue(new HouseholdMemberIdentityConflict());
    const request = req({
      as: "parentA",
      body: {
        choreId: chore.id,
        ...(operation === "edit"
          ? { assigned_to: "parent-a" }
          : operation === "reject"
            ? { decision: "reject" }
            : {}),
      },
    });
    if (operation === "reject") db.find("user", "child-a")!.family_id = null;
    const response = await (operation === "edit"
      ? PATCH(request)
      : operation === "undo"
        ? undo(request)
        : verify(request));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "IDENTITY_CONFLICT" });
    expect(db.find("chore", chore.id)).toEqual(before);
  },
);
