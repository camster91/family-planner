// Route-level test for GET /api/files/[filename]: authentication happens
// before any filesystem access, so an unauthenticated caller cannot even
// learn whether a file exists.

const mockReadFile = jest.fn();
const mockExistsSync = jest.fn();

jest.mock("fs/promises", () => ({ readFile: (...a: unknown[]) => mockReadFile(...a) }));
jest.mock("fs", () => ({ existsSync: (...a: unknown[]) => mockExistsSync(...a) }));

jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    headers: Headers;
    body: unknown;
    constructor(body?: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new Headers(init?.headers);
    }
    static json(data: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      return new MockNextResponse(data, init);
    }
  }
  return { NextResponse: MockNextResponse, NextRequest: class {} };
});

jest.mock("@/lib/api-auth", () => ({
  authenticateRequest: jest.fn(),
}));

import { GET } from "../route";
import { authenticateRequest } from "@/lib/api-auth";

const mockAuth = authenticateRequest as jest.Mock;

const FILE = "0123456789abcdef.jpg";

function makeRequest() {
  return { headers: new Headers(), cookies: { get: () => undefined } } as any;
}

function ctx(filename: string) {
  return { params: Promise.resolve({ filename }) };
}

describe("GET /api/files/[filename]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(Buffer.from("jpeg-bytes"));
  });

  it("returns 401 for an unauthenticated caller before any fs access", async () => {
    const unauthorized = { status: 401, body: { error: "Unauthorized" } };
    mockAuth.mockResolvedValue([null, unauthorized]);

    const res = (await GET(makeRequest(), ctx(FILE))) as any;

    expect(res.status).toBe(401);
    expect(res).toBe(unauthorized);
    expect(mockAuth).toHaveBeenCalledTimes(1);
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("returns the same 401 whether or not the file exists", async () => {
    mockAuth.mockResolvedValue([null, { status: 401 }]);
    mockExistsSync.mockReturnValue(false);

    const res = (await GET(makeRequest(), ctx(FILE))) as any;

    expect(res.status).toBe(401);
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it("rejects a traversal-shaped filename with 404 without auth or fs access", async () => {
    const res = (await GET(makeRequest(), ctx("../../etc/passwd"))) as any;
    expect(res.status).toBe(404);
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("serves the file privately to an authenticated caller", async () => {
    mockAuth.mockResolvedValue([{ userId: "parent-a" }, null]);

    const res = (await GET(makeRequest(), ctx(FILE))) as any;

    expect(res.status).toBe(200);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
  });
});
