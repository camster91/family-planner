jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/api-auth", () => ({ authenticateWithFamily: jest.fn() }));
jest.mock("@/lib/rate-limit-db", () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true })),
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appFeedback: { findMany: jest.fn(async () => []), upsert: jest.fn() },
  },
}));
import { GET, POST } from "../route";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit-db";
import type { NextRequest } from "next/server";
const draft = {
  requestId: "24db1d70-1278-4e01-b4aa-a0efc1f7387d",
  kind: "bug",
  title: "Calendar overflow",
  details: "Calendar spills over the phone screen.",
  page: "/dashboard/calendar",
};
const req = (body: unknown = draft) =>
  ({ text: async () => JSON.stringify(body) }) as NextRequest;
beforeEach(() => {
  jest.clearAllMocks();
  (authenticateWithFamily as jest.Mock).mockResolvedValue([
    { user: { id: "user-a", family_id: "family-a", role: "child" } },
    null,
  ]);
  (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });
  (prisma!.appFeedback.upsert as jest.Mock).mockImplementation(
    async ({ create }) => ({ ...create, id: "receipt", status: "received" }),
  );
});
it("lists only this user in this household, never another family or other member", async () => {
  expect((await GET(req())).status).toBe(200);
  expect(prisma!.appFeedback.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { user_id: "user-a", family_id: "family-a" },
    }),
  );
});
it("persists a private report with server ownership and deduplicated request key, including child reports", async () => {
  expect((await POST(req())).status).toBe(201);
  expect(prisma!.appFeedback.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        user_id_request_id: { user_id: "user-a", request_id: draft.requestId },
      },
      update: {},
      create: expect.objectContaining({
        user_id: "user-a",
        family_id: "family-a",
        title: draft.title,
      }),
    }),
  );
});
it("does not reveal an earlier household report on replay", async () => {
  (prisma!.appFeedback.upsert as jest.Mock).mockResolvedValue({
    id: "secret",
    family_id: "family-b",
    details: "private",
  });
  const response = await POST(req());
  expect(response.status).toBe(404);
  expect(JSON.stringify(await response.json())).not.toContain("private");
});
it("rejects ownership overrides, URLs with private queries, and short reports", async () => {
  for (const body of [
    { ...draft, user_id: "user-b" },
    { ...draft, page: "/dashboard?token=private" },
    { ...draft, details: "short" },
  ])
    expect((await POST(req(body))).status).toBe(400);
  expect(prisma!.appFeedback.upsert).not.toHaveBeenCalled();
});
it("requires auth and respects rate limit", async () => {
  const { NextResponse } = require("next/server");
  (authenticateWithFamily as jest.Mock).mockResolvedValue([
    null,
    NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  ]);
  expect((await POST(req())).status).toBe(401);
  (authenticateWithFamily as jest.Mock).mockResolvedValue([
    { user: { id: "a", family_id: "family-a" } },
    null,
  ]);
  (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: false });
  expect((await POST(req())).status).toBe(429);
  expect(prisma!.appFeedback.upsert).not.toHaveBeenCalled();
});
