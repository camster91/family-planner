// Two-household isolation for the chores API (#102): list, update, delete,
// create, complete, uncomplete (Undo, #268) and verify.

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
import { POST as uncomplete } from "../uncomplete/route";
import { awardChoreXP } from "@/lib/gamification-server";
import { db, fakePrisma, req, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

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
      (await uncomplete(req({ body: { choreId: "chore-a" } }))).status,
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
    await expectDenied(await uncomplete(req({ as: "parentA", body: { choreId: "chore-b" } })));
    expect(db.find("chore", "chore-b")?.status).toBe("completed");
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

  describe("uncomplete (Undo for a tick, #268)", () => {
    it("the assignee reopens their own completed chore; repeating is a no-op", async () => {
      expect((await complete(req({ as: "childA", body: { choreId: "chore-a" } }))).status).toBe(200);
      const res = await uncomplete(req({ as: "childA", body: { choreId: "chore-a" } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, status: "pending" });
      expect(db.find("chore", "chore-a")?.status).toBe("pending");
      expect(db.find("chore", "chore-a")?.completed_at).toBeNull();

      const again = await uncomplete(req({ as: "childA", body: { choreId: "chore-a" } }));
      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({ alreadyOpen: true });
    });

    it("a parent may reopen any household chore", async () => {
      db.find("chore", "chore-a")!.status = "completed";
      expect((await uncomplete(req({ as: "parentA", body: { choreId: "chore-a" } }))).status).toBe(200);
      expect(db.find("chore", "chore-a")?.status).toBe("pending");
    });

    it("a teen who is not the assignee cannot reopen it", async () => {
      db.find("chore", "chore-a")!.status = "completed";
      expect((await uncomplete(req({ as: "teenA", body: { choreId: "chore-a" } }))).status).toBe(403);
      expect(db.find("chore", "chore-a")?.status).toBe("completed");
      expect(db.writes).toHaveLength(0);
    });

    it("refuses a chore a parent has already verified (409) and changes nothing", async () => {
      db.find("chore", "chore-a")!.status = "verified";
      const res = await uncomplete(req({ as: "childA", body: { choreId: "chore-a" } }));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "CHORE_ALREADY_VERIFIED" });
      expect(db.find("chore", "chore-a")?.status).toBe("verified");
      expect(db.writes).toHaveLength(0);
    });

    it("rejects a missing choreId with 400", async () => {
      expect((await uncomplete(req({ as: "childA", body: {} }))).status).toBe(400);
    });

    it("removes exactly the successor its completion created, not a look-alike chore", async () => {
      const chore = db.find("chore", "chore-a")!;
      chore.frequency = "daily";
      chore.recurrence_id = null;
      const before = new Set(db.rows("chore").map((r: any) => r.id));
      expect((await complete(req({ as: "childA", body: { choreId: "chore-a" } }))).status).toBe(200);
      const created = db.rows("chore").filter((r: any) => !before.has(r.id));
      expect(created).toHaveLength(1);
      const successorId = created[0].id;
      expect(db.find("chore", "chore-a")?.successor_id).toBe(successorId);

      // An unrelated one-off with the same title, assignee and date (added by a
      // parent after the tick) must survive the Undo.
      db.rows("chore").push({ ...created[0], id: "look-alike", created_at: new Date(Date.now() + 1000) });

      expect((await uncomplete(req({ as: "childA", body: { choreId: "chore-a" } }))).status).toBe(200);
      expect(db.find("chore", successorId)).toBeUndefined();
      expect(db.find("chore", "look-alike")).toBeDefined();
      expect(db.find("chore", "chore-a")?.successor_id).toBeNull();

      // Completing again creates one successor, not a duplicate.
      const count = db.rows("chore").length;
      expect((await complete(req({ as: "childA", body: { choreId: "chore-a" } }))).status).toBe(200);
      expect(db.rows("chore").length).toBe(count + 1);
    });

    it("a chore completed before successor_id existed reopens and deletes nothing", async () => {
      const chore = db.find("chore", "chore-a")!;
      chore.frequency = "daily";
      chore.recurrence_id = null;
      chore.status = "completed";
      chore.completed_at = new Date();
      const count = db.rows("chore").length;
      expect((await uncomplete(req({ as: "childA", body: { choreId: "chore-a" } }))).status).toBe(200);
      expect(db.rows("chore").length).toBe(count);
      expect(writesTo("chore").some((w) => w.op === "deleteMany")).toBe(false);
    });

    it("is a 409, not a false success, when a parent verifies between the check and the update", async () => {
      db.find("chore", "chore-a")!.status = "completed";
      const original = fakePrisma.chore.findUnique;
      const spy = jest.spyOn(fakePrisma.chore, "findUnique").mockImplementationOnce(async (args: any) => {
        const row = await original(args);
        // The parent's verify lands right after the route's first read.
        db.find("chore", "chore-a")!.status = "verified";
        return row;
      });
      try {
        const res = await uncomplete(req({ as: "childA", body: { choreId: "chore-a" } }));
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: "CHORE_ALREADY_VERIFIED" });
        expect(db.find("chore", "chore-a")?.status).toBe("verified");
      } finally {
        spy.mockRestore();
      }
    });
  });
});
