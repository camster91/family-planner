// POST /api/upload: rate limit, per-household quota, bad bodies, and the
// opportunistic cleanup of stale unreferenced uploads.
//
// The real route runs on the two-household fake Prisma client; the filesystem
// is an in-memory map.

const mockFiles = new Map<string, Buffer>();

jest.mock("fs/promises", () => ({
  writeFile: async (p: string, buf: Buffer) => {
    mockFiles.set(p, Buffer.from(buf));
  },
  mkdir: async () => undefined,
  rename: async (from: string, to: string) => {
    const buf = mockFiles.get(from);
    if (!buf) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockFiles.delete(from);
    mockFiles.set(to, buf);
  },
  unlink: async (p: string) => {
    if (!mockFiles.delete(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  },
}));
jest.mock("fs", () => ({ existsSync: (p: string) => mockFiles.has(p) || !/\.[a-z]+$/i.test(p) }));

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/rate-limit-db", () => ({ checkRateLimit: jest.fn() }));

import path from "path";
import { POST as upload } from "@/app/api/upload/route";
import { db, fakePrisma, req, FAMILY_A, FAMILY_B, type UserKey } from "@/__tests__/helpers/two-household";
import { checkRateLimit } from "@/lib/rate-limit-db";
import {
  FAMILY_UPLOAD_QUOTA_BYTES,
  STALE_UPLOAD_AGE_MS,
  STALE_UPLOAD_BATCH,
  UPLOAD_RATE_LIMIT_MAX,
  UPLOAD_RATE_LIMIT_WINDOW_MS,
} from "@/lib/upload-housekeeping";

const mockRate = checkRateLimit as jest.Mock;

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/data/family-planner-uploads";
const CHORES_DIR = path.join(UPLOAD_DIR, "chores");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const OLD = new Date(Date.now() - STALE_UPLOAD_AGE_MS - 60_000);
const FRESH = new Date(Date.now() - 60_000);

function uploadReq(as: UserKey, bytes: Buffer = JPEG, headers: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(bytes)], "photo.jpg", { type: "image/jpeg" }));
  return { ...req({ as, method: "POST", headers }), formData: async () => fd };
}

let seq = 0;
/** Add an Upload row (and its file) as POST /api/upload would have. */
function seedUpload(family_id: string, opts: { created_at?: Date; size_bytes?: number; filename?: string } = {}) {
  seq += 1;
  const filename = opts.filename ?? `${seq.toString(16).padStart(16, "0")}.jpg`;
  const row = {
    id: `up-${seq}`,
    family_id,
    uploaded_by: null,
    filename,
    content_type: "image/jpeg",
    size_bytes: opts.size_bytes ?? 100,
    created_at: opts.created_at ?? OLD,
  };
  db.tables.upload.push(row);
  mockFiles.set(path.join(CHORES_DIR, filename), Buffer.from("x"));
  return row;
}

const uploadIds = () => db.rows("upload").map((r: any) => r.id);

describe("POST /api/upload — limits", () => {
  beforeEach(() => {
    db.reset();
    mockFiles.clear();
    seq = 0;
    mockRate.mockReset();
    mockRate.mockResolvedValue({ allowed: true, retryAfterMs: 0, remaining: 29 });
  });

  it("rate-limits per user (30 per hour) with a 429 and Retry-After", async () => {
    mockRate.mockResolvedValue({ allowed: false, retryAfterMs: 120_000, remaining: 0 });

    const res: any = await upload(uploadReq("parentA") as never);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(mockRate).toHaveBeenCalledWith("upload:parent-a", UPLOAD_RATE_LIMIT_MAX, UPLOAD_RATE_LIMIT_WINDOW_MS);
    expect(UPLOAD_RATE_LIMIT_MAX).toBe(30);
    expect(db.rows("upload")).toHaveLength(0);
  });

  it("answers 400, not 500, when the body is not form data", async () => {
    const bad = {
      ...req({ as: "parentA", method: "POST", headers: { "content-type": "application/json" } }),
      formData: async () => {
        throw new TypeError("Content-Type was not one of multipart/form-data or application/x-www-form-urlencoded.");
      },
    };

    const res: any = await upload(bad as never);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/multipart\/form-data/);
  });

  it("refuses a declared body far larger than one photo with 413 before reading it", async () => {
    const formData = jest.fn();
    const big = { ...req({ as: "parentA", method: "POST", headers: { "content-length": String(50 * 1024 * 1024) } }), formData };

    const res: any = await upload(big as never);

    expect(res.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
  });

  it("refuses an upload that would take the household over its quota (413, no row, no file)", async () => {
    seedUpload(FAMILY_A, { created_at: FRESH, size_bytes: FAMILY_UPLOAD_QUOTA_BYTES - 5 });

    const res: any = await upload(uploadReq("parentA") as never);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/storage/i) });
    expect(db.rows("upload")).toHaveLength(1);
    expect([...mockFiles.keys()].filter((k) => k.endsWith(".tmp"))).toHaveLength(0);
    expect(mockFiles.size).toBe(1);
  });

  it("counts only the caller's household toward the quota", async () => {
    seedUpload(FAMILY_B, { created_at: FRESH, size_bytes: FAMILY_UPLOAD_QUOTA_BYTES });

    const res: any = await upload(uploadReq("parentA") as never);

    expect(res.status).toBe(200);
  });

  it("an upload exactly filling the quota is accepted", async () => {
    seedUpload(FAMILY_A, { created_at: FRESH, size_bytes: FAMILY_UPLOAD_QUOTA_BYTES - JPEG.length });

    expect(((await upload(uploadReq("parentA") as never)) as any).status).toBe(200);
  });

  it("a same-household re-upload of stored bytes is not refused by the quota", async () => {
    const first: any = await upload(uploadReq("parentA") as never);
    expect(first.status).toBe(200);
    seedUpload(FAMILY_A, { created_at: FRESH, size_bytes: FAMILY_UPLOAD_QUOTA_BYTES });

    const again: any = await upload(uploadReq("parentA") as never);

    expect(again.status).toBe(200);
  });
});

describe("POST /api/upload — opportunistic cleanup", () => {
  beforeEach(() => {
    db.reset();
    mockFiles.clear();
    seq = 0;
    mockRate.mockReset();
    mockRate.mockResolvedValue({ allowed: true, retryAfterMs: 0, remaining: 29 });
  });

  it("removes stale unreferenced uploads of the caller's household only, rows and files", async () => {
    const stale = seedUpload(FAMILY_A);
    const fresh = seedUpload(FAMILY_A, { created_at: FRESH });
    const onChore = seedUpload(FAMILY_A);
    const onAssignment = seedUpload(FAMILY_A);
    const onAssignmentBare = seedUpload(FAMILY_A);
    const onBoard = seedUpload(FAMILY_A);
    const foreignStale = seedUpload(FAMILY_B);

    db.tables.chore.push({ ...db.rows("chore")[0], id: "chore-photo", family_id: FAMILY_A, photo_url: `/api/files/chores/${onChore.filename}` });
    db.tables.choreAssignment.push(
      { id: "asg-1", family_id: FAMILY_A, chore_id: "chore-a", assigned_to: "child-a", photo_url: `/api/files/${onAssignment.filename}` },
      { id: "asg-2", family_id: FAMILY_A, chore_id: "chore-a", assigned_to: "child-a", photo_url: onAssignmentBare.filename }
    );
    const famA = db.tables.family.find((f: any) => f.id === FAMILY_A)!;
    famA.ambient_photo_ids = [onBoard.id];

    const res: any = await upload(uploadReq("parentA") as never);

    expect(res.status).toBe(200);
    const ids = uploadIds();
    expect(ids).not.toContain(stale.id);
    expect(mockFiles.has(path.join(CHORES_DIR, stale.filename))).toBe(false);
    for (const kept of [fresh, onChore, onAssignment, onAssignmentBare, onBoard, foreignStale]) {
      expect(ids).toContain(kept.id);
      expect(mockFiles.has(path.join(CHORES_DIR, kept.filename))).toBe(true);
    }
  });

  it("removes at most one batch per upload", async () => {
    for (let i = 0; i < STALE_UPLOAD_BATCH + 5; i++) seedUpload(FAMILY_A);

    const res: any = await upload(uploadReq("parentA") as never);

    expect(res.status).toBe(200);
    // 5 stale rows left plus the new upload.
    expect(db.rows("upload").filter((r: any) => r.family_id === FAMILY_A)).toHaveLength(6);
  });

  it("never removes the row a same-household re-upload is reusing", async () => {
    const first: any = await upload(uploadReq("parentA") as never);
    const { filename } = await first.json();
    const row = db.rows("upload").find((r: any) => r.filename === filename)!;
    row.created_at = OLD; // stale and unreferenced

    const again: any = await upload(uploadReq("parentA") as never);

    expect(again.status).toBe(200);
    expect(db.rows("upload").map((r: any) => r.filename)).toContain(filename);
    expect(mockFiles.has(path.join(CHORES_DIR, filename))).toBe(true);
  });

  it("frees space for a household at its quota", async () => {
    seedUpload(FAMILY_A, { size_bytes: FAMILY_UPLOAD_QUOTA_BYTES }); // stale, unreferenced

    const res: any = await upload(uploadReq("parentA") as never);

    expect(res.status).toBe(200);
  });

  it("a cleanup failure never fails the upload", async () => {
    seedUpload(FAMILY_A);
    const original = fakePrisma.chore.findMany;
    fakePrisma.chore.findMany = async () => {
      throw new Error("db down");
    };
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const res: any = await upload(uploadReq("parentA") as never);
      expect(res.status).toBe(200);
    } finally {
      fakePrisma.chore.findMany = original;
      errorSpy.mockRestore();
    }
  });
});
