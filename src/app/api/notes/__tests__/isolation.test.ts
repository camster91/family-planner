// Two-household isolation for /api/notes and /api/notes/[id] (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
const mockFeatureGate = jest.fn(async (..._args: unknown[]): Promise<unknown> => null);
jest.mock("@/lib/feature-gate-server", () => ({
  featureGate: (...args: unknown[]) => mockFeatureGate(...args),
}));

import * as notes from "../route";
import * as note from "../[id]/route";
import { db, req, fakePrisma, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";
import { hashDeviceToken } from "@/lib/device-session";

const originalPinnedNoteCreate = fakePrisma.pinnedNote.create;

describe("notes — two households", () => {
  beforeEach(() => {
    db.reset();
    // The canonical writer renews stored permission inside its transaction.
    // Ownership tests need notes enabled; a mock route gate grants no access.
    db.find("family", "family-A")!.features = { notes: true };
    db.find("family", "family-B")!.features = { notes: true };
    for (const row of db.rows("pinnedNote")) row.updated_at ??= row.created_at ?? new Date();
    jest.spyOn(fakePrisma.pinnedNote, "create").mockImplementation(async (args: any) => {
      const created = await originalPinnedNoteCreate(args);
      const row = db.find("pinnedNote", String(created.id));
      if (row) row.updated_at ??= row.created_at ?? new Date();
      return created;
    });
    mockFeatureGate.mockResolvedValue(null);
  });

  afterEach(() => jest.restoreAllMocks());

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
    expect(body.notes[0]).toMatchObject({ can_edit: false, can_delete: false });
  });

  // Authored/unrun. Equal timestamps must continue by ID; foreign cursors
  // cannot widen the authenticated household scope or change permissions.
  it("pages notes within the household and retains the legacy whole-list mode", async () => {
    db.rows("pinnedNote").splice(0);
    const created_at = new Date("2026-10-24T12:00:00Z");
    for (const id of ["note-a", "note-b", "note-c"]) {
      db.rows("pinnedNote").push({ id, family_id: "family-A", title: id,
        body: "Fixture", color: "yellow", created_by: "parent-a", created_at });
    }
    db.rows("pinnedNote").push({ id: "foreign-note", family_id: "family-B",
      title: "Foreign", body: "Private", color: "yellow", created_by: "parent-b", created_at });
    const read = jest.spyOn(fakePrisma.pinnedNote, "findMany");
    let firstResponse: Response;
    try {
      firstResponse = await notes.GET(req({ as: "teenA", query: { limit: "2" } }));
      expect(read).toHaveBeenCalledWith({
        where: { family_id: "family-A" },
        orderBy: [{ created_at: "desc" }, { id: "asc" }], take: 3,
      });
    } finally { read.mockRestore(); }
    const first = await firstResponse.json();
    expect(first.notes.map((row: any) => row.id)).toEqual(["note-a", "note-b"]);
    expect(first.notes[0]).toMatchObject({ can_edit: false, can_delete: false });
    expect(typeof first.nextCursor).toBe("string");
    const second = await (await notes.GET(req({ as: "teenA", query: { limit: "2", cursor: first.nextCursor } }))).json();
    expect(second.notes.map((row: any) => row.id)).toEqual(["note-c"]);
    expect(second.nextCursor).toBeNull();
    expect((await notes.GET(req({ as: "parentB", query: { limit: "2", cursor: first.nextCursor } }))).status).toBe(400);
    const legacy = await (await notes.GET(req({ as: "parentA" }))).json();
    expect(legacy.notes).toHaveLength(3);
    expect(legacy).not.toHaveProperty("nextCursor");
    expect(db.writes).toHaveLength(0);
  });

  it("returns server-computed ownership permissions without changing the note DTO", async () => {
    const created = await notes.POST(req({ as: "teenA", body: { title: "Mine" } }));
    expect(created.status).toBe(201);

    const teenBody = await expectNoForeignData(await notes.GET(req({ as: "teenA" })));
    const own = teenBody.notes.find((n: any) => n.title === "Mine");
    const parentNote = teenBody.notes.find((n: any) => n.id === "note-a");
    expect(own).toMatchObject({ title: "Mine", can_edit: true, can_delete: false });
    expect(parentNote).toMatchObject({ id: "note-a", can_edit: false, can_delete: false });

    const parentBody = await expectNoForeignData(await notes.GET(req({ as: "parentA" })));
    expect(parentBody.notes.find((n: any) => n.id === "note-a")).toMatchObject({
      can_edit: true,
      can_delete: true,
    });
  });

  it("honours the feature gate before returning or writing notes", async () => {
    mockFeatureGate.mockResolvedValue({ status: 403 } as Response);

    expect((await notes.GET(req({ as: "parentA" }))).status).toBe(403);
    expect((await notes.POST(req({ as: "parentA", body: { title: "Blocked" } }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("refuses a valid paired device before person auth on every Notes handler", async () => {
    process.env.SHARED_DEVICE_ENABLED = "1";
    try {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      db.rows("householdDevice").push({ id: "dev-a", family_id: "family-A", revoked_at: null });
      db.rows("deviceSession").push({
        id: "ds-a",
        device_id: "dev-a",
        family_id: "family-A",
        access_token_hash: hashDeviceToken("tablet-token"),
        refresh_token_hash: "refresh-hash",
        access_expires_at: future,
        refresh_expires_at: future,
        revoked_at: null,
        rotated_at: null,
      });
      const writes = db.writes.length;
      const requests = [
        [notes.GET, req({ as: "parentA" })],
        [notes.POST, req({ as: "parentA", method: "POST", body: { title: "blocked" } })],
        [note.PATCH, req({ as: "parentA", method: "PATCH", body: { id: "note-a", title: "blocked" } })],
        [note.DELETE, req({ as: "parentA", method: "DELETE", body: { id: "note-a" } })],
      ] as const;

      for (const [handler, request] of requests) {
        request.cookies = {
          get: (name: string) =>
            name === "fp_device"
              ? { value: "tablet-token" }
              : name === "session_token"
                ? { value: "session:parent-a" }
                : undefined,
        };
        const response = await handler(request);
        expect(response.status).toBe(403);
        expect((await response.json()).error.code).toBe("DEVICE_WRITE_NOT_ALLOWED");
      }
      expect(db.writes).toHaveLength(writes);
    } finally {
      delete process.env.SHARED_DEVICE_ENABLED;
    }
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
  it("refuses edit/delete when stored Notes permission changed after the route gate", async () => {
    // The route gate deliberately stays mocked open; transaction renewal owns this decision.
    db.find("family", "family-A")!.features = { notes: false };
    expect((await note.PATCH(req({ as: "parentA", body: { id: "note-a", title: "Blocked draft" } }))).status).toBe(403);
    expect((await note.DELETE(req({ as: "parentA", body: { id: "note-a" } }))).status).toBe(403);
    expect(db.find("pinnedNote", "note-a")?.title).toBe("Home wifi");
    expect(db.writes).toHaveLength(0);
  });

});

// Authored only: bound creates refuse a moved owner before key/effect work.
it('reports the personal write context and refuses different account/household expectations', async () => {
  db.reset();
  const context = (await (await notes.GET(req({ as: 'parentA' }))).json()).writeContext;
  expect(context).toEqual({ userId: 'parent-a', familyId: 'family-A' });
  db.writes.splice(0);
  for (const expected of [
    { expected_user_id: 'parent-b', expected_family_id: 'family-A' },
    { expected_user_id: 'parent-a', expected_family_id: 'family-B' },
  ]) {
    const response = await notes.POST(req({ as: 'parentA', body: { title: 'Bound draft', ...expected } }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('NOTE_OWNER_CHANGED');
  }
  expect((await notes.POST(req({ as: 'parentA', body: { title: 'Incomplete owner', expected_user_id: 'parent-a' } }))).status).toBe(400);
  expect(db.writes).toHaveLength(0);
});
