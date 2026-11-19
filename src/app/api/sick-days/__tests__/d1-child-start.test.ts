// Owner decision 2026-11-19: on the D1 (production) path a child is refused
// "Start a sick day" before the native effect runs, in either household; a
// teen reporting themselves still reaches it, and a child still reads.

jest.mock("next/server", () => {
  const { NextRequest } = jest.requireActual(
    "next/server",
  ) as typeof import("next/server");
  return {
    NextRequest,
    NextResponse: {
      json: (data: unknown, init?: any) => ({
        status: init?.status ?? 200,
        headers: new Headers(init?.headers),
        json: async () => data,
      }),
    },
  };
});
jest.mock("@/lib/storage-backend", () => ({ storageBackend: () => "d1" }));
const mockActor = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  getServerActor: () => mockActor(),
  getServerUser: jest.fn(),
}));
jest.mock("@/lib/device-route", () => ({ refusePairedDevice: async () => null }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
const mockCreate = jest.fn(async () => ({ status: 201, body: { sickDay: { id: "new" } } }));
const mockRead = jest.fn(async () => ({ status: 200, body: { sickDays: [] } }));
jest.mock("@/lib/cloudflare/health", () => ({
  createD1SickDay: (...args: unknown[]) => mockCreate(...(args as [])),
  readD1SickDays: (...args: unknown[]) => mockRead(...(args as [])),
}));

import { NextRequest } from "next/server";
import { GET, POST } from "../route";

const actor = (id: string, role: string, family_id: string) =>
  mockActor.mockResolvedValue({ id, role, family_id, tokenVersion: 0 });
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/sick-days", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  mockCreate.mockClear();
  mockRead.mockClear();
});

describe("sick days on D1 — a child does not start one", () => {
  it.each([
    ["child-a", "family-A"],
    ["child-b", "family-B"],
  ])("refuses %s with 403 and never reaches the effect", async (id, family) => {
    actor(id, "child", family);
    const res = await POST(post({ person_id: id, severity: "mild" }));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("a child still reads their own sick days", async () => {
    actor("child-a", "child", "family-A");
    const res = await GET(new NextRequest("http://localhost/api/sick-days"));
    expect(res.status).toBe(200);
    expect(mockRead).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "child-a", familyId: "family-A", role: "child" }),
    );
  });

  it("a teen reporting themselves reaches the native effect", async () => {
    actor("teen-a", "teen", "family-A");
    const res = await POST(post({ person_id: "teen-a", severity: "mild" }));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
