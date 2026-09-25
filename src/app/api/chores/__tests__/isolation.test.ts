// Two-household isolation for the chores API (#102): list, update, delete,
// create, complete and verify.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/notifications-server", () => require("@/__tests__/helpers/two-household").notificationsMock);
jest.mock("@/lib/gamification-server", () => ({
  awardChoreXP: jest.fn(async () => ({ levelUp: false, newLevel: 1 })),
}));

import * as chores from "../route";
import { POST as create } from "../create/route";
import { POST as complete } from "../complete/route";
import { POST as verify } from "../verify/route";
import { awardChoreXP } from "@/lib/gamification-server";
import { db, req, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

const newChore = {
  title: "Feed cat",
  points: 10,
  assigned_to: "child-a",
  due_date: "2026-10-01T00:00:00.000Z",
  difficulty: "easy",
  frequency: "once",
};

describe("chores — two households", () => {
  beforeEach(() => {
    db.reset();
    (awardChoreXP as jest.Mock).mockClear();
  });

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    const statuses = [
      (await chores.GET(req())).status,
      (await chores.PATCH(req({ body: { choreId: "chore-a", title: "x" } }))).status,
      (await chores.DELETE(req({ body: { choreId: "chore-a" } }))).status,
      (await create(req({ body: newChore }))).status,
      (await complete(req({ body: { choreId: "chore-a" } }))).status,
      (await verify(req({ body: { choreId: "chore-a" } }))).status,
    ];
    expect(new Set(statuses)).toEqual(new Set([401]));
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family, even when filtering by a foreign assignee", async () => {
    const all = await expectNoForeignData(await chores.GET(req({ as: "childA" })));
    expect(all.chores.map((c: any) => c.id)).toEqual(["chore-a"]);
    const foreign = await expectNoForeignData(await chores.GET(req({ as: "parentA", query: { assigned_to: "child-b" } })));
    expect(foreign.chores).toEqual([]);
  });

  it("refuses to update, delete, complete or verify another family's chore", async () => {
    await expectDenied(await chores.PATCH(req({ as: "parentA", body: { choreId: "chore-b", title: "x" } })));
    await expectDenied(await chores.DELETE(req({ as: "parentA", body: { choreId: "chore-b" } })));
    await expectDenied(await complete(req({ as: "childA", body: { choreId: "chore-b" } })));
    db.find("chore", "chore-b")!.status = "completed";
    await expectDenied(await verify(req({ as: "parentA", body: { choreId: "chore-b" } })));
    expect(db.writes).toHaveLength(0);
    expect(awardChoreXP).not.toHaveBeenCalled();
  });

  it("rejects creating a chore assigned to a family-B user", async () => {
    const res = await create(req({ as: "parentA", body: { ...newChore, assigned_to: "child-b" } }));
    expect(res.status).toBe(400);
    expect(writesTo("chore")).toHaveLength(0);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s cannot create or verify chores", async (who) => {
    expect((await create(req({ as: who, body: newChore }))).status).toBe(403);
    db.find("chore", "chore-a")!.status = "completed";
    expect((await verify(req({ as: who, body: { choreId: "chore-a" } }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("a teen who is not the assignee cannot edit or delete the chore", async () => {
    expect((await chores.PATCH(req({ as: "teenA", body: { choreId: "chore-a", title: "x" } }))).status).toBe(403);
    expect((await chores.DELETE(req({ as: "teenA", body: { choreId: "chore-a" } }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("same-family happy path: create, complete, verify", async () => {
    const created = await create(req({ as: "parentA", body: { ...newChore, family_id: "family-B" } }));
    expect(created.status).toBe(200);
    expect(writesTo("chore")[0].args.data).toMatchObject({ family_id: "family-A", assigned_to: "child-a" });

    expect((await complete(req({ as: "childA", body: { choreId: "chore-a" } }))).status).toBe(200);
    expect(db.find("chore", "chore-a")?.status).toBe("completed");
    expect((await verify(req({ as: "parentA", body: { choreId: "chore-a" } }))).status).toBe(200);
    expect(db.find("chore", "chore-a")?.status).toBe("verified");
    expect(awardChoreXP).toHaveBeenCalledWith("child-a", "easy", 10, expect.anything());
  });
});
