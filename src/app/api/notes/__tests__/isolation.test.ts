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
import { db, req, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";
import { hashDeviceToken } from "@/lib/device-session";

describe("notes — two households", () => {
  beforeEach(() => {
    db.reset();
    // The canonical writer renews stored permission inside its transaction.
    // Ownership tests need notes enabled; a mock route gate grants no access.
    db.find("family", "family-A")!.features = { notes: true };
    db.find("family", "family-B")!.features = { notes: true };
    mockFeatureGate.mockResolvedValue(null);
  });

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
});
