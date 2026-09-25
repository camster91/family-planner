// Route-level test for GET /api/files/[filename] (legacy upload root).
//
// Authentication happens before any filesystem access, so an unauthenticated
// caller cannot even learn whether a file exists. Household isolation (#102):
// a session alone is not enough — only the family whose chore (or chore
// assignment) references the file is served; everyone else gets the same 404
// as a missing file.

const mockReadFile = jest.fn();
const mockExistsSync = jest.fn();

jest.mock("fs/promises", () => ({ readFile: (...a: unknown[]) => mockReadFile(...a) }));
jest.mock("fs", () => ({ existsSync: (...a: unknown[]) => mockExistsSync(...a) }));

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));

import { GET } from "../route";
import { db, req, params } from "@/__tests__/helpers/two-household";

const FILE_A = "0123456789abcdef.jpg";
const FILE_B = "fedcba9876543210.png";

describe("GET /api/files/[filename]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.reset();
    db.find("chore", "chore-a")!.photo_url = `/api/files/${FILE_A}`;
    db.find("chore", "chore-b")!.photo_url = FILE_B; // bare-name legacy form
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(Buffer.from("jpeg-bytes"));
  });

  it("returns 401 for an unauthenticated caller before any fs access", async () => {
    const res = (await GET(req(), params({ filename: FILE_A }))) as any;

    expect(res.status).toBe(401);
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("returns the same 401 whether or not the file exists", async () => {
    mockExistsSync.mockReturnValue(false);

    const res = (await GET(req(), params({ filename: FILE_A }))) as any;

    expect(res.status).toBe(401);
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it("rejects a traversal-shaped filename with 404 without auth or fs access", async () => {
    const res = (await GET(req({ as: "parentA" }), params({ filename: "../../etc/passwd" }))) as any;
    expect(res.status).toBe(404);
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("serves the file privately to a member of the owning family (child included)", async () => {
    for (const who of ["parentA", "childA"] as const) {
      const res = (await GET(req({ as: who }), params({ filename: FILE_A }))) as any;
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/jpeg");
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
    }
  });

  it("serves a file referenced only by a chore assignment of the caller's family", async () => {
    db.rows("choreAssignment").push({ id: "ca-a", family_id: "family-A", photo_url: `/api/files/${FILE_B}` });
    db.find("chore", "chore-b")!.photo_url = null;
    const res = (await GET(req({ as: "parentA" }), params({ filename: FILE_B }))) as any;
    expect(res.status).toBe(200);
  });

  it("refuses another family's file with the same 404 as a missing one", async () => {
    const res = (await GET(req({ as: "parentA" }), params({ filename: FILE_B }))) as any;
    expect(res.status).toBe(404);
    expect(mockReadFile).not.toHaveBeenCalled();
    // ...and the owning family still can.
    expect(((await GET(req({ as: "parentB" }), params({ filename: FILE_B }))) as any).status).toBe(200);
  });

  it("does not serve an unreferenced file to anyone", async () => {
    const res = (await GET(req({ as: "parentA" }), params({ filename: "aaaaaaaaaaaaaaaa.webp" }))) as any;
    expect(res.status).toBe(404);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("returns 400 for a signed-in user with no family, without fs access", async () => {
    const res = (await GET(req({ as: "loner" }), params({ filename: FILE_A }))) as any;
    expect(res.status).toBe(400);
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
