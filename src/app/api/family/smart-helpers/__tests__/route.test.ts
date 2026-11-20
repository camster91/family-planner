// /api/family/smart-helpers (#144): parent-only household AI switch, off by
// default, cannot be turned on when the deployment has no smart helpers.
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/prisma", () => ({ prisma: null }));
jest.mock("@/lib/storage-backend", () => ({ storageBackend: () => "d1" }));
jest.mock("@/lib/cloudflare/database", () => ({
  getD1Database: async () => ({ fake: "d1" }),
}));
jest.mock("@/lib/api-auth", () => {
  const { nextServerMock } = jest.requireActual(
    "@/__tests__/helpers/two-household",
  );
  return {
    authenticateWithFamily: async (request: { role: string }) => [
      {
        payload: { userId: "u", tv: 0 },
        user: {
          id: "u",
          family_id: "family-A",
          role: request.role,
          name: "x",
          last_chore_date: null,
        },
      },
      null,
    ],
    requireParent: (role: string) =>
      role === "parent"
        ? null
        : nextServerMock.NextResponse.json(
            { error: "Only parents" },
            { status: 403 },
          ),
  };
});
const mockWrite = jest.fn();
jest.mock("@/lib/ai/household-setting", () => ({
  ...jest.requireActual("@/lib/ai/household-setting"),
  readHouseholdAiSetting: async () => ({
    enabled: false,
    monthlyCapMicrousd: "2000000",
    revision: 0,
  }),
  readManagedAiMonthSpend: async () => "0",
  writeHouseholdAiSetting: (...args: unknown[]) => mockWrite(...args),
}));

import { GET, PUT } from "../route";

function req(role: string, body?: unknown) {
  const json = body === undefined ? "" : JSON.stringify(body);
  return {
    role,
    headers: new Headers({
      "content-type": "application/json",
      "content-length": String(json.length),
    }),
    body: null,
    json: async () => body,
    text: async () => json,
    cookies: { get: () => undefined },
  } as never;
}

const env = process.env;
beforeEach(() => {
  process.env = { ...env };
  delete process.env.FAMILY_CLAUDE_AI_READY;
  mockWrite
    .mockReset()
    .mockResolvedValue({
      enabled: true,
      monthlyCapMicrousd: "2000000",
      revision: 1,
    });
});
afterAll(() => {
  process.env = env;
});

it("is parent-only and reports off by default with the $2 cap", async () => {
  expect((await GET(req("teen"))).status).toBe(403);
  expect((await GET(req("child"))).status).toBe(403);
  expect(await (await GET(req("parent"))).json()).toEqual({
    deploymentReady: false,
    enabled: false,
    revision: 0,
    monthlyCapMicrousd: "2000000",
    spentThisMonthMicrousd: "0",
  });
});

it("cannot be switched on while the deployment has no smart helpers, but can always be switched off", async () => {
  expect(
    (await PUT(req("parent", { enabled: true, expectedRevision: 0 }))).status,
  ).toBe(409);
  expect(mockWrite).not.toHaveBeenCalled();
  expect(
    (await PUT(req("parent", { enabled: false, expectedRevision: 0 }))).status,
  ).toBe(200);
  expect(mockWrite).toHaveBeenCalledWith(
    expect.anything(),
    { userId: "u", familyId: "family-A", generation: 0 },
    false,
    0,
  );
});

it("turns on for a parent when the deployment is ready, and refuses teens and extra fields", async () => {
  Object.assign(process.env, {
    FAMILY_CLAUDE_AI_READY: "1",
    FAMILY_AI_ANTHROPIC_API_KEY: "sk-test-not-real",
    FAMILY_AI_USAGE_READY: "1",
    FAMILY_AI_USAGE_ROLLBACK_READY: "1",
  });
  expect(
    (await PUT(req("teen", { enabled: true, expectedRevision: 0 }))).status,
  ).toBe(403);
  expect(
    (await PUT(req("parent", { enabled: true, expectedRevision: 0, cap: 99 })))
      .status,
  ).toBe(400);
  expect(
    (await PUT(req("parent", { enabled: true, expectedRevision: 0 }))).status,
  ).toBe(200);
  expect(mockWrite).toHaveBeenCalledTimes(1);
});
