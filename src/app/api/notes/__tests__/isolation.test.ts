// Two-household isolation for /api/notes and /api/notes/[id] (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as notes from "../route";
import * as note from "../[id]/route";
import { db, req, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

describe("notes — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    expect((await notes.GET(req())).status).toBe(401);
    expect((await notes.POST(req({ body: { title: "x" } }))).status).toBe(401);
    expect((await note.PATCH(req({ body: { id: "note-a", title: "x" } }))).status).toBe(401);
    expect((await note.DELETE(req({ body: { id: "note-a" } }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family", async () => {
    const body = await expectNoForeignData(await notes.GET(req({ as: "childA" })));
    expect(body.notes.map((n: any) => n.id)).toEqual(["note-a"]);
  });

  it("refuses to update or delete another family's note", async () => {
    await expectDenied(await note.PATCH(req({ as: "parentA", body: { id: "note-b", title: "x" } })));
    await expectDenied(await note.DELETE(req({ as: "parentA", body: { id: "note-b" } })));
    expect(db.writes).toHaveLength(0);
  });

  it("same-family create, update, delete", async () => {
    expect((await notes.POST(req({ as: "parentA", body: { title: "Bins", family_id: "family-B" } }))).status).toBe(201);
    expect(writesTo("pinnedNote")[0].args.data).toMatchObject({ family_id: "family-A" });
    expect((await note.PATCH(req({ as: "parentA", body: { id: "note-a", title: "New" } }))).status).toBe(200);
    expect((await note.DELETE(req({ as: "parentA", body: { id: "note-a" } }))).status).toBe(200);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("D9: %s can create a note and edit their own", async (who) => {
    const res = await notes.POST(req({ as: who, body: { title: "Mine" } }));
    expect(res.status).toBe(201);
    const id = (await res.json()).note.id;
    expect((await note.PATCH(req({ as: who, body: { id, title: "Still mine" } }))).status).toBe(200);
    expect(db.find("pinnedNote", id)?.title).toBe("Still mine");
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("D9: %s cannot edit a note someone else created", async (who) => {
    expect((await note.PATCH(req({ as: who, body: { id: "note-a", title: "hijack" } }))).status).toBe(403);
    expect(db.find("pinnedNote", "note-a")?.title).toBe("Home wifi");
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("D9: %s cannot delete a note, even their own", async (who) => {
    db.find("pinnedNote", "note-a")!.created_by = who === "teenA" ? "teen-a" : "child-a";
    expect((await note.DELETE(req({ as: who, body: { id: "note-a" } }))).status).toBe(403);
    expect(db.find("pinnedNote", "note-a")).toBeDefined();
  });

  it("D9: a family-B child cannot edit a family-A note", async () => {
    db.find("pinnedNote", "note-a")!.created_by = "child-b";
    await expectDenied(await note.PATCH(req({ as: "childB", body: { id: "note-a", title: "x" } })));
    expect(db.writes).toHaveLength(0);
  });
});
