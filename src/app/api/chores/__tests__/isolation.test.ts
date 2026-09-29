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

  describe("verify: approve and reject (parent check)", () => {
    it("approve moves a completed chore to verified and reports the server state", async () => {
      db.find("chore", "chore-a")!.status = "completed";
      const res = await verify(req({ as: "parentA", body: { choreId: "chore-a", decision: "approve" } }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.chore).toMatchObject({ id: "chore-a", status: "verified", photo_verified: true });
      expect(db.find("chore", "chore-a")?.status).toBe("verified");
      expect(awardChoreXP).toHaveBeenCalledTimes(1);
    });

    it("reject sends a completed chore back to pending with the reason and awards nothing", async () => {
      const chore = db.find("chore", "chore-a")!;
      chore.status = "completed";
      chore.completed_at = new Date();
      const res = await verify(
        req({ as: "parentA", body: { choreId: "chore-a", decision: "reject", verificationNotes: "  Toys still on the floor " } })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ success: true, rejected: true });
      expect(body.chore).toMatchObject({
        id: "chore-a",
        status: "pending",
        completed_at: null,
        photo_verified: false,
        verified_notes: "Toys still on the floor",
      });
      expect(db.find("chore", "chore-a")).toMatchObject({ status: "pending", completed_at: null });
      expect(writesTo("activity")[0].args.data).toMatchObject({ type: "chore_rejected", family_id: "family-A" });
      expect(awardChoreXP).not.toHaveBeenCalled();

      // The child can tick it again.
      expect((await complete(req({ as: "childA", body: { choreId: "chore-a" } }))).status).toBe(200);
      expect(db.find("chore", "chore-a")?.status).toBe("completed");
    });

    it("reject of an open chore is a no-op success; of a verified chore is 409", async () => {
      const open = await verify(req({ as: "parentA", body: { choreId: "chore-a", decision: "reject" } }));
      expect(open.status).toBe(200);
      expect(await open.json()).toMatchObject({ alreadyOpen: true, chore: { status: "pending" } });

      db.find("chore", "chore-a")!.status = "verified";
      const done = await verify(req({ as: "parentA", body: { choreId: "chore-a", decision: "reject" } }));
      expect(done.status).toBe(409);
      expect(await done.json()).toMatchObject({ code: "CHORE_ALREADY_VERIFIED" });
      expect(db.find("chore", "chore-a")?.status).toBe("verified");
      // The open-chore no-op matched no row; nothing else was written.
      expect(writesTo("activity")).toHaveLength(0);
      expect(db.writes.filter((w) => w.op !== "updateMany")).toHaveLength(0);
    });

    it("reject removes exactly the successor completion recorded", async () => {
      const chore = db.find("chore", "chore-a")!;
      chore.frequency = "daily";
      chore.recurrence_id = null;
      const before = new Set(db.rows("chore").map((r: any) => r.id));
      expect((await complete(req({ as: "childA", body: { choreId: "chore-a" } }))).status).toBe(200);
      const successorId = db.rows("chore").find((r: any) => !before.has(r.id))!.id;
      const res = await verify(req({ as: "parentA", body: { choreId: "chore-a", decision: "reject" } }));
      expect(res.status).toBe(200);
      expect(db.find("chore", successorId)).toBeUndefined();
      expect(db.find("chore", "chore-a")).toMatchObject({ status: "pending", successor_id: null });
    });

    it("reject is 409 when another parent verifies between the check and the update", async () => {
      db.find("chore", "chore-a")!.status = "completed";
      const original = fakePrisma.chore.findUnique;
      let calls = 0;
      const spy = jest.spyOn(fakePrisma.chore, "findUnique").mockImplementation(async (args: any) => {
        const row = await original(args);
        // The other parent's verify lands right after the route's own read.
        if (++calls === 1) db.find("chore", "chore-a")!.status = "verified";
        return row;
      });
      try {
        const res = await verify(req({ as: "parentA", body: { choreId: "chore-a", decision: "reject" } }));
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: "CHORE_ALREADY_VERIFIED" });
        expect(db.find("chore", "chore-a")?.status).toBe("verified");
        expect(writesTo("activity")).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    });

    it("children, teens and other households cannot reject; an unknown decision is 400", async () => {
      db.find("chore", "chore-a")!.status = "completed";
      db.find("chore", "chore-b")!.status = "completed";
      expect((await verify(req({ as: "childA", body: { choreId: "chore-a", decision: "reject" } }))).status).toBe(403);
      expect((await verify(req({ as: "teenA", body: { choreId: "chore-a", decision: "reject" } }))).status).toBe(403);
      await expectDenied(await verify(req({ as: "parentA", body: { choreId: "chore-b", decision: "reject" } })));
      expect((await verify(req({ as: "parentA", body: { choreId: "chore-a", decision: "maybe" } }))).status).toBe(400);
      expect(db.find("chore", "chore-a")?.status).toBe("completed");
      expect(db.find("chore", "chore-b")?.status).toBe("completed");
      expect(db.writes).toHaveLength(0);
    });
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

  describe("picture routines (#272): icon, routine, routine_order", () => {
    it("create stores the picture, the trimmed routine name and the step", async () => {
      const res = await create(
        req({ as: "parentA", body: { ...newChore, icon: "brush-teeth", routine: "  Morning  ", routine_order: 2 } })
      );
      expect(res.status).toBe(200);
      expect(writesTo("chore")[0].args.data).toMatchObject({ icon: "brush-teeth", routine: "Morning", routine_order: 2 });
      expect((await res.json()).chore).toMatchObject({ icon: "brush-teeth", routine: "Morning", routine_order: 2 });
    });

    it("create without them stores nulls (old clients unchanged)", async () => {
      expect((await create(req({ as: "parentA", body: newChore }))).status).toBe(200);
      expect(writesTo("chore")[0].args.data).toMatchObject({ icon: null, routine: null, routine_order: null });
    });

    it.each([
      ["an unknown icon", { icon: "rocket-launch" }],
      ["a routine over 40 characters", { routine: "x".repeat(41) }],
      ["a step of 0", { routine: "Morning", routine_order: 0 }],
      ["a fractional step", { routine: "Morning", routine_order: 1.5 }],
    ])("create rejects %s with 400 and writes nothing", async (_label, extra) => {
      const res = await create(req({ as: "parentA", body: { ...newChore, ...extra } }));
      expect(res.status).toBe(400);
      expect(writesTo("chore")).toHaveLength(0);
    });

    it("PATCH sets and clears them; an empty routine clears it", async () => {
      const set = await chores.PATCH(
        req({ as: "parentA", body: { choreId: "chore-a", icon: "shoes", routine: "After school", routine_order: 3 } })
      );
      expect(set.status).toBe(200);
      expect(db.find("chore", "chore-a")).toMatchObject({ icon: "shoes", routine: "After school", routine_order: 3 });

      const cleared = await chores.PATCH(
        req({ as: "parentA", body: { choreId: "chore-a", icon: null, routine: "   ", routine_order: null } })
      );
      expect(cleared.status).toBe(200);
      expect(db.find("chore", "chore-a")).toMatchObject({ icon: null, routine: null, routine_order: null });
    });

    it("PATCH of another household's chore is refused and changes nothing", async () => {
      await expectDenied(
        await chores.PATCH(req({ as: "parentA", body: { choreId: "chore-b", icon: "hug", routine: "Morning", routine_order: 1 } }))
      );
      expect(db.find("chore", "chore-b")?.icon).toBeUndefined();
      expect(db.writes).toHaveLength(0);
    });

    it("a sibling cannot set a routine on someone else's chore", async () => {
      expect(
        (await chores.PATCH(req({ as: "teenA", body: { choreId: "chore-a", routine: "Morning" } }))).status
      ).toBe(403);
      expect(db.writes).toHaveLength(0);
    });

    it("GET returns the fields for the caller's household only", async () => {
      Object.assign(db.find("chore", "chore-a")!, { icon: "hug", routine: "Bedtime", routine_order: 1 });
      Object.assign(db.find("chore", "chore-b")!, { icon: "trash", routine: "Evening", routine_order: 4 });
      const body = await expectNoForeignData(await chores.GET(req({ as: "childA" })));
      expect(body.chores).toEqual([expect.objectContaining({ id: "chore-a", icon: "hug", routine: "Bedtime", routine_order: 1 })]);
    });

    it("completing a legacy recurring chore copies them to the next occurrence", async () => {
      Object.assign(db.find("chore", "chore-a")!, {
        frequency: "daily",
        recurrence_id: null,
        icon: "make-bed",
        routine: "Morning",
        routine_order: 1,
      });
      expect((await complete(req({ as: "childA", body: { choreId: "chore-a" } }))).status).toBe(200);
      const successor = writesTo("chore").find((w) => w.op === "create");
      expect(successor?.args.data).toMatchObject({ icon: "make-bed", routine: "Morning", routine_order: 1 });
    });
  });
});
