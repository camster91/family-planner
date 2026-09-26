// D3 (#102): chore photo ownership, end to end across two households.
//
// POST /api/upload records an Upload row (family + uploader) for every stored
// file. Chore create / update / complete accept a photo only when it names an
// Upload owned by the caller's family. GET /api/files/chores/[filename] serves
// a file to its Upload family, or — for legacy files with no Upload row — to
// the family whose chore or chore assignment references it.
//
// The real routes run on the two-household fake Prisma client; only the
// filesystem is replaced by an in-memory map.

const mockFiles = new Map<string, Buffer>();

jest.mock("fs/promises", () => ({
  writeFile: async (p: string, buf: Buffer) => {
    mockFiles.set(p, Buffer.from(buf));
  },
  mkdir: async () => undefined,
  readFile: async (p: string) => {
    const buf = mockFiles.get(p);
    if (!buf) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return buf;
  },
}));
// Directories (no extension) always "exist"; files exist once written.
jest.mock("fs", () => ({ existsSync: (p: string) => mockFiles.has(p) || !/\.[a-z]+$/i.test(p) }));

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/notifications-server", () => require("@/__tests__/helpers/two-household").notificationsMock);
jest.mock("@/lib/gamification-server", () => ({
  awardChoreXP: jest.fn(async () => ({ levelUp: false, newLevel: 1 })),
}));

import path from "path";
import { POST as upload } from "@/app/api/upload/route";
import { GET as serveChorePhoto } from "@/app/api/files/chores/[filename]/route";
import * as chores from "@/app/api/chores/route";
import { POST as createChore } from "@/app/api/chores/create/route";
import { POST as completeChore } from "@/app/api/chores/complete/route";
import { db, req, params, writesTo, type UserKey } from "@/__tests__/helpers/two-household";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/data/family-planner-uploads";
// A minimal JPEG: the SOI marker is all sniffImageType needs.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
// Legacy files referenced by the seeded chores (no Upload row).
const LEGACY_A = "aaaaaaaaaaaaaaaa.jpg";
const LEGACY_B = "bbbbbbbbbbbbbbbb.jpg";

const newChore = {
  title: "Feed cat",
  points: 10,
  assigned_to: "child-a",
  due_date: "2026-10-01T00:00:00.000Z",
  difficulty: "easy",
  frequency: "once",
};

function uploadReq(as: UserKey, bytes: Buffer = JPEG) {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(bytes)], "photo.jpg", { type: "image/jpeg" }));
  return { ...req({ as, method: "POST" }), formData: async () => fd };
}

async function uploadAs(as: UserKey, bytes: Buffer = JPEG): Promise<{ url: string; filename: string }> {
  const res = await upload(uploadReq(as, bytes) as never);
  expect(res.status).toBe(200);
  return (res as any).json();
}

async function view(as: UserKey, filename: string) {
  return (await serveChorePhoto(req({ as }), params({ filename }))) as any;
}

describe("D3 chore photo ownership — two households", () => {
  beforeEach(() => {
    db.reset();
    mockFiles.clear();
    mockFiles.set(path.join(UPLOAD_DIR, "chores", LEGACY_A), Buffer.from("legacy-a"));
    mockFiles.set(path.join(UPLOAD_DIR, "chores", LEGACY_B), Buffer.from("legacy-b"));
  });

  it("records the caller's family and the uploader for every stored file", async () => {
    const { url, filename } = await uploadAs("childA");

    expect(url).toBe(`/api/files/chores/${filename}`);
    const rows = db.rows("upload");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      family_id: "family-A",
      uploaded_by: "child-a",
      filename,
      content_type: "image/jpeg",
      size_bytes: JPEG.length,
    });
    expect(mockFiles.has(path.join(UPLOAD_DIR, "chores", filename))).toBe(true);

    // Same image again in the same family: same file, no second row.
    const again = await uploadAs("parentA");
    expect(again.filename).toBe(filename);
    expect(db.rows("upload")).toHaveLength(1);
  });

  it("namespaces filenames per family, so identical images never share an owner row", async () => {
    const a = await uploadAs("parentA");
    const b = await uploadAs("parentB");
    expect(b.filename).not.toBe(a.filename);
    expect(db.rows("upload").map((r) => [r.filename, r.family_id])).toEqual([
      [a.filename, "family-A"],
      [b.filename, "family-B"],
    ]);
  });

  it("serves a family its own upload (before and after attaching) and 404s everyone else", async () => {
    const { filename, url } = await uploadAs("parentA");

    expect((await view("childA", filename)).status).toBe(200);
    expect((await view("parentB", filename)).status).toBe(404);
    expect((await view(null as never, filename)).status).toBe(401);

    const created = await createChore(req({ as: "parentA", body: { ...newChore, photo_url: url } }));
    expect(created.status).toBe(200);
    expect(writesTo("chore")[0].args.data.photo_url).toBe(url);
    expect((await view("teenA", filename)).status).toBe(200);
    expect((await view("childB", filename)).status).toBe(404);
  });

  it("family B cannot attach family A's upload to a B chore (400), by path or bare filename", async () => {
    const { filename, url } = await uploadAs("parentA");

    const bChore = { ...newChore, assigned_to: "child-b" };
    for (const ref of [url, filename]) {
      expect((await createChore(req({ as: "parentB", body: { ...bChore, photo_url: ref } }))).status).toBe(400);
      expect((await chores.PATCH(req({ as: "parentB", body: { choreId: "chore-b", photo_url: ref } }))).status).toBe(400);
      expect((await completeChore(req({ as: "childB", body: { choreId: "chore-b", photoUrl: ref } }))).status).toBe(400);
    }

    expect(writesTo("chore")).toHaveLength(0);
    expect(db.find("chore", "chore-b")).toMatchObject({
      photo_url: `/api/files/chores/${LEGACY_B}`,
      status: "pending",
    });
  });

  it("family B still cannot view A's upload after trying to attach it", async () => {
    const { filename, url } = await uploadAs("parentA");
    await chores.PATCH(req({ as: "parentB", body: { choreId: "chore-b", photo_url: url } }));
    expect((await view("parentB", filename)).status).toBe(404);

    // Even if a B chore referenced it (e.g. written before D3), the Upload row
    // is authoritative and the legacy reference fallback does not apply.
    db.find("chore", "chore-b")!.photo_url = url;
    expect((await view("parentB", filename)).status).toBe(404);
    expect((await view("childB", filename)).status).toBe(404);
    expect((await view("parentA", filename)).status).toBe(200);
  });

  it("rejects photo references that are not an owned upload", async () => {
    const bad = [
      "https://evil.example/cat.jpg",
      `/api/files/${LEGACY_A}`,
      "/api/files/chores/../../etc/passwd",
      `/api/files/chores/${LEGACY_A}?x=1`,
      "data:image/jpeg;base64,/9j/4AAQ",
      // Well-formed but never uploaded (and not the chore's current value).
      "/api/files/chores/0123456789abcdef.jpg",
      LEGACY_B,
    ];
    for (const ref of bad) {
      const res = await chores.PATCH(req({ as: "parentA", body: { choreId: "chore-a", photo_url: ref } }));
      expect({ ref, status: res.status }).toEqual({ ref, status: 400 });
    }
    expect(writesTo("chore")).toHaveLength(0);
  });

  it("family A attaches its own upload on update and complete, stored in canonical form", async () => {
    const first = await uploadAs("parentA");
    const res = await chores.PATCH(req({ as: "parentA", body: { choreId: "chore-a", photo_url: first.filename } }));
    expect(res.status).toBe(200);
    expect(db.find("chore", "chore-a")?.photo_url).toBe(first.url);

    const second = await uploadAs("childA", Buffer.concat([JPEG, Buffer.from([1])]));
    const done = await completeChore(req({ as: "childA", body: { choreId: "chore-a", photoUrl: second.url } }));
    expect(done.status).toBe(200);
    expect(db.find("chore", "chore-a")).toMatchObject({
      status: "completed",
      photo_url: second.url,
      photo_verified: false,
    });
  });

  it("legacy: a chore photo with no Upload row is still viewable by its own family only", async () => {
    expect(db.rows("upload")).toHaveLength(0);
    expect((await view("parentA", LEGACY_A)).status).toBe(200);
    expect((await view("childA", LEGACY_A)).status).toBe(200);
    expect((await view("parentB", LEGACY_A)).status).toBe(404);
    expect((await view("parentB", LEGACY_B)).status).toBe(200);
    expect((await view("parentA", LEGACY_B)).status).toBe(404);

    // Referenced through a chore assignment (bare-name form) also still works.
    db.find("chore", "chore-a")!.photo_url = null;
    db.rows("choreAssignment").push({ id: "ca-a", family_id: "family-A", photo_url: LEGACY_A });
    expect((await view("parentA", LEGACY_A)).status).toBe(200);
    expect((await view("parentB", LEGACY_A)).status).toBe(404);
  });

  it("legacy: editing a legacy chore that re-sends its current photo still works; clearing works", async () => {
    const legacyUrl = `/api/files/chores/${LEGACY_A}`;
    const res = await chores.PATCH(
      req({ as: "parentA", body: { choreId: "chore-a", title: "Renamed", photo_url: legacyUrl } })
    );
    expect(res.status).toBe(200);
    expect(db.find("chore", "chore-a")).toMatchObject({ title: "Renamed", photo_url: legacyUrl });

    const cleared = await chores.PATCH(req({ as: "parentA", body: { choreId: "chore-a", photo_url: null } }));
    expect(cleared.status).toBe(200);
    expect(db.find("chore", "chore-a")?.photo_url).toBeNull();

    // Once detached, a legacy file cannot be re-attached: new attachments need an Upload row.
    const reattach = await chores.PATCH(req({ as: "parentA", body: { choreId: "chore-a", photo_url: legacyUrl } }));
    expect(reattach.status).toBe(400);
  });

  it("creates a chore without a photo when photo_url is null (the create form sends null)", async () => {
    const res = await createChore(req({ as: "parentA", body: { ...newChore, photo_url: null } }));
    expect(res.status).toBe(200);
    expect(writesTo("chore")[0].args.data.photo_url).toBeNull();
  });
});
