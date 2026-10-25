jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/api-auth", () => ({ authenticateWithFamily: jest.fn() }));
jest.mock("@/lib/rate-limit-db", () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true })),
}));
jest.mock("@/lib/household-lock", () => ({
  lockUser: jest.fn(async () => undefined),
  lockHousehold: jest.fn(async () => undefined),
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (run: (tx: unknown) => unknown) =>
      run(require("@/lib/prisma").prisma),
    user: { findFirst: jest.fn(async () => ({ token_version: 0 })) },
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
  (prisma!.user.findFirst as jest.Mock).mockResolvedValue({ token_version: 0 });
  (authenticateWithFamily as jest.Mock).mockResolvedValue([
    {
      payload: { tv: 0 },
      user: { id: "user-a", family_id: "family-a", role: "child" },
    },
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

it.each(["kind", "title", "details", "page"] as const)(
  "refuses same-key changed %s without disclosing or overwriting the earlier report",
  async (field) => {
    (prisma!.appFeedback.upsert as jest.Mock).mockResolvedValue({
      ...draft,
      family_id: "family-a",
      request_id: draft.requestId,
      id: "earlier-private-receipt",
      [field]: field === "kind" ? "feature" : "Earlier private value",
    });
    const res = await POST(req());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ code: "REPORT_REQUEST_CONFLICT" });
    expect(JSON.stringify(body)).not.toContain("earlier-private-receipt");
    expect(prisma!.appFeedback.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
  },
);
it.each([null, { token_version: 1 }])(
  "refuses stale membership/session before writing a report",
  async (member) => {
    (prisma!.user.findFirst as jest.Mock).mockResolvedValue(member);
    expect((await POST(req())).status).toBe(401);
    expect(prisma!.appFeedback.upsert).not.toHaveBeenCalled();
  },
);

// Source assertions authored only; API/DB/QA execution remains deferred.
const summaryRequest = () => ({ ...req(), headers: new Headers({ 'X-Herewoven-Feedback-View': 'summary-v1' }) }) as unknown as NextRequest;
it('projects opted-in report summaries without details, pathname, owner or request identifiers', async () => {
  const row = { ...draft, id: 'receipt', user_id: 'user-a', family_id: 'family-a', request_id: draft.requestId, status: 'received', created_at: new Date('2026-10-25T12:00:00Z') };
  (prisma!.appFeedback.findMany as jest.Mock).mockResolvedValueOnce([row]);
  const response = await GET(summaryRequest());
  expect(response.status).toBe(200);
  expect(JSON.parse(await response.text())).toEqual({ reports: [{ id: 'receipt', kind: draft.kind, title: draft.title, status: 'received', created_at: '2026-10-25T12:00:00.000Z' }] });
  expect(prisma!.appFeedback.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { user_id: 'user-a', family_id: 'family-a' }, take: 25,
    select: { id: true, kind: true, title: true, status: true, created_at: true },
  }));
});
it('returns only a summary receipt after the original ownership and exact-body checks', async () => {
  (prisma!.appFeedback.upsert as jest.Mock).mockImplementationOnce(async ({ create }) => ({ ...create, id: 'receipt', status: 'received', created_at: new Date('2026-10-25T12:00:00Z') }));
  const response = await POST(summaryRequest());
  expect(response.status).toBe(201);
  expect(JSON.parse(await response.text())).toEqual({ report: { id: 'receipt', kind: draft.kind, title: draft.title, status: 'received', created_at: '2026-10-25T12:00:00.000Z' } });
});
it('preserves the legacy report representation without the summary opt-in', async () => {
  const response = await POST(req());
  expect(response.status).toBe(201);
  expect((await response.json()).report).toMatchObject({ details: draft.details, page: draft.page, user_id: 'user-a', family_id: 'family-a', request_id: draft.requestId });
});
