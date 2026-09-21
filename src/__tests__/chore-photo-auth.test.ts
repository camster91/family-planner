// Regression tests for #207 (P1): chore verification photos must not be served
// to unauthenticated callers or to a different family.
//
// The route resolves ownership through the chore that references the photo, so
// these tests mock both the auth helper and prisma, and assert the decision the
// route makes: 401 without a session, 404 for a cross-family read, 200 for the
// owning family.

const readFile = jest.fn()
const existsSync = jest.fn()

jest.mock("fs/promises", () => ({ readFile: (...a: unknown[]) => readFile(...a) }))
jest.mock("fs", () => ({ existsSync: (...a: unknown[]) => existsSync(...a) }))

const choreFindFirst = jest.fn()
const assignmentFindFirst = jest.fn()

jest.mock("@/lib/prisma", () => ({
  prisma: {
    chore: { get findFirst() { return choreFindFirst } },
    choreAssignment: { get findFirst() { return assignmentFindFirst } },
  },
}))

const authenticateWithFamily = jest.fn()

jest.mock("@/lib/api-auth", () => ({
  authenticateWithFamily: (...a: unknown[]) => authenticateWithFamily(...a),
}))

jest.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: class {
    body: unknown
    status: number
    headers: Record<string, string>
    constructor(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.body = body
      this.status = init?.status ?? 200
      this.headers = init?.headers ?? {}
    }
  },
}))

import { GET } from "@/app/api/files/chores/[filename]/route";

const FILE = "abcdef0123456789.jpg"

function req() {
  return {} as never
}

async function callGet(filename: string) {
  return (await GET(req(), { params: Promise.resolve({ filename }) })) as unknown as {
    status: number
    body: unknown
    headers: Record<string, string>
  }
}

describe("GET /api/files/chores/[filename]", () => {
  beforeEach(() => {
    choreFindFirst.mockReset()
    assignmentFindFirst.mockReset()
    authenticateWithFamily.mockReset()
    readFile.mockReset()
    existsSync.mockReset()
  })

  it("rejects an unauthenticated caller before touching the filesystem", async () => {
    authenticateWithFamily.mockResolvedValue([
      null,
      { status: 401, body: "Unauthorized", headers: {} },
    ])

    const res = await callGet(FILE)

    expect(res.status).toBe(401)
    expect(choreFindFirst).not.toHaveBeenCalled()
    expect(existsSync).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
  })

  it("refuses a cross-family read, and does not confirm the file exists", async () => {
    authenticateWithFamily.mockResolvedValue([
      { payload: { userId: "u1" }, user: { id: "u1", family_id: "fam-A", role: "parent" } },
      null,
    ])
    // The photo belongs to fam-B.
    choreFindFirst.mockResolvedValue({ family_id: "fam-B" })

    const res = await callGet(FILE)

    expect(res.status).toBe(404)
    expect(readFile).not.toHaveBeenCalled()
  })

  it("serves the file to the owning family, with private cache headers", async () => {
    authenticateWithFamily.mockResolvedValue([
      { payload: { userId: "u1" }, user: { id: "u1", family_id: "fam-A", role: "parent" } },
      null,
    ])
    choreFindFirst.mockResolvedValue({ family_id: "fam-A" })
    existsSync.mockReturnValue(true)
    readFile.mockResolvedValue(Buffer.from("image-bytes"))

    const res = await callGet(FILE)

    expect(res.status).toBe(200)
    expect(res.headers["Cache-Control"]).toBe("private, max-age=300")
    expect(res.headers["Cache-Control"]).not.toContain("public")
  })

  it("does not serve a file no chore references", async () => {
    authenticateWithFamily.mockResolvedValue([
      { payload: { userId: "u1" }, user: { id: "u1", family_id: "fam-A", role: "parent" } },
      null,
    ])
    choreFindFirst.mockResolvedValue(null)
    assignmentFindFirst.mockResolvedValue(null)

    const res = await callGet(FILE)

    expect(res.status).toBe(404)
    expect(readFile).not.toHaveBeenCalled()
  })

  it("rejects a filename outside the allowlist", async () => {
    const res = await callGet("../../etc/passwd")

    expect(res.status).toBe(404)
    expect(authenticateWithFamily).not.toHaveBeenCalled()
  })
})
