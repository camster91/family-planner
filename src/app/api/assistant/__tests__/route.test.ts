jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/api-auth", () => ({ authenticateWithFamily: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: {
      findUnique: jest.fn(async () => ({
        features: {},
        capture_ai_key_enc: "encrypted",
      })),
    },
  },
}));
jest.mock("@/lib/rate-limit-db", () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true })),
}));
let mockTodayEnabled = false;
jest.mock("@/lib/assistant-today-capability", () => ({
  isAssistantTodayEnabled: jest.fn(() => mockTodayEnabled),
}));
jest.mock("@/lib/assistant-today-context", () => ({
  ASSISTANT_TODAY_PROTOCOL: "herewoven.assistant-today.v1",
  ASSISTANT_TODAY_TTL_MS: 60_000,
  loadAssistantTodayContext: jest.fn(),
  AssistantTodayInputError: class extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));
jest.mock("@/lib/assistant-references", () => ({
  ...jest.requireActual("@/lib/assistant-references"),
  isAssistantReferencesEnabled: jest.fn(() => false),
  loadReferencedAssistantToday: jest.fn(),
}));
jest.mock("@/lib/capture", () => ({
  resolveCaptureConfig: jest.fn(() => ({ model: "test" })),
  structuredAssistantReply: jest.fn(),
  CaptureError: class extends Error {
    status = 502;
  },
}));
import {
  isAssistantReferencesEnabled,
  loadReferencedAssistantToday,
  buildAssistantReferenceCatalog,
} from "@/lib/assistant-references";
import { POST } from "../route";
import { authenticateWithFamily } from "@/lib/api-auth";
import { resolveCaptureConfig, structuredAssistantReply } from "@/lib/capture";
import { prisma } from "@/lib/prisma";
import {
  AssistantTodayInputError,
  loadAssistantTodayContext,
} from "@/lib/assistant-today-context";
import { checkRateLimit } from "@/lib/rate-limit-db";
import type { NextRequest } from "next/server";
const input = {
  messages: [{ role: "user", content: "Add milk" }],
  localNow: "2026-10-09",
  timeZone: "America/Toronto",
};
const request = (body: unknown = input) =>
  ({
    text: async () => JSON.stringify(body),
    headers: new Headers({
      "X-Assistant-References": "herewoven.assistant-references.v1",
    }),
  }) as NextRequest;
afterEach(() => jest.restoreAllMocks());
beforeEach(() => {
  jest
    .spyOn(Date, "now")
    .mockReturnValue(Date.parse("2026-10-09T12:00:30.000Z"));
  jest.clearAllMocks();
  mockTodayEnabled = false;
  jest.mocked(isAssistantReferencesEnabled).mockReturnValue(false);
  (loadAssistantTodayContext as jest.Mock).mockResolvedValue(null);
  (authenticateWithFamily as jest.Mock).mockResolvedValue([
    { user: { id: "a", role: "parent", family_id: "family-a" } },
    null,
  ]);
  (resolveCaptureConfig as jest.Mock).mockReturnValue({ model: "test" });
  (structuredAssistantReply as jest.Mock).mockResolvedValue({
    reply: "Review milk",
    action: { kind: "grocery_add", title: "Milk" },
  });
});
it("uses current household configuration and sends chat text only", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(prisma!.family.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: "family-a" } }),
  );
  expect((structuredAssistantReply as jest.Mock).mock.calls[0][0]).toEqual(
    input,
  );
});
it("children are refused before provider/database access", async () => {
  (authenticateWithFamily as jest.Mock).mockResolvedValue([
    { user: { id: "c", role: "child", family_id: "family-a" } },
    null,
  ]);
  expect((await POST(request())).status).toBe(403);
  expect(prisma!.family.findUnique).not.toHaveBeenCalled();
});
it("unconfigured AI returns an honest unavailable response", async () => {
  (resolveCaptureConfig as jest.Mock).mockReturnValue(null);
  const result = await POST(request());
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual(
    expect.objectContaining({ code: "ASSISTANT_PROVIDER_NOT_CONFIGURED" }),
  );
  expect(structuredAssistantReply).not.toHaveBeenCalled();
});
it("blocks forbidden action even when provider proposes it", async () => {
  (authenticateWithFamily as jest.Mock).mockResolvedValue([
    { user: { id: "t", role: "teen", family_id: "family-a" } },
    null,
  ]);
  (structuredAssistantReply as jest.Mock).mockResolvedValue({
    reply: "Delete",
    action: { kind: "list_delete", title: "Food" },
  });
  expect((await (await POST(request())).json()).action).toBeNull();
});
it("rejects malformed requests and arbitrary provider tools", async () => {
  expect((await POST(request({ messages: [] }))).status).toBe(400);
  (structuredAssistantReply as jest.Mock).mockResolvedValue({
    reply: "Do it",
    action: { kind: "execute", url: "/api/users" },
  });
  expect((await POST(request())).status).toBe(502);
});
it("keeps the optional Today capability dormant without contacting the provider", async () => {
  const result = await POST(request({ ...input, includeToday: true }));
  expect(result.status).toBe(503);
  expect(structuredAssistantReply).not.toHaveBeenCalled();
  expect(loadAssistantTodayContext).not.toHaveBeenCalled();
});
it("passes a validated Today projection separately and returns freshness headers", async () => {
  mockTodayEnabled = true;
  const context = {
    protocol: "herewoven.assistant-today.v1",
    generatedAt: "2026-10-09T12:00:00.000Z",
    expiresAt: "2026-10-09T12:01:00.000Z",
    viewer: {
      role: "parent",
      localDate: "2026-10-09",
      timeZone: "America/Toronto",
    },
    today: {
      events: [],
      chores: [],
      dinner: null,
      groceries: [],
      useSoon: [],
      weather: null,
      unavailable: ["weather"],
    },
  };
  (loadAssistantTodayContext as jest.Mock).mockResolvedValue(context);
  const result = await POST(request({ ...input, includeToday: true }));
  expect(result.status).toBe(200);
  expect((structuredAssistantReply as jest.Mock).mock.calls[0][0]).toEqual(
    input,
  );
  expect((structuredAssistantReply as jest.Mock).mock.calls[0][3]).toEqual(
    context,
  );
  expect(result.headers.get("X-Assistant-Today-Protocol")).toBe(
    "herewoven.assistant-today.v1",
  );
  expect(result.headers.get("X-Assistant-Today-Expires-At")).toBe(
    context.expiresAt,
  );
});
it("rejects invalid Today input before provider transport", async () => {
  mockTodayEnabled = true;
  (loadAssistantTodayContext as jest.Mock).mockRejectedValue(
    new AssistantTodayInputError("INVALID_TIME_ZONE"),
  );
  const result = await POST(request({ ...input, includeToday: true }));
  expect(result.status).toBe(400);
  expect(structuredAssistantReply).not.toHaveBeenCalled();
});
it("fails closed when the fresh Today projection is unavailable", async () => {
  mockTodayEnabled = true;
  (loadAssistantTodayContext as jest.Mock).mockResolvedValue(null);
  const result = await POST(request({ ...input, includeToday: true }));
  expect(result.status).toBe(503);
  expect(structuredAssistantReply).not.toHaveBeenCalled();
});
it("checks provider configuration and rate limits before Today DB loading", async () => {
  mockTodayEnabled = true;
  (resolveCaptureConfig as jest.Mock).mockReturnValueOnce(null);
  expect((await POST(request({ ...input, includeToday: true }))).status).toBe(
    503,
  );
  expect(loadAssistantTodayContext).not.toHaveBeenCalled();

  (resolveCaptureConfig as jest.Mock).mockReturnValue({ model: "test" });
  (checkRateLimit as jest.Mock).mockResolvedValueOnce({ allowed: false });
  expect((await POST(request({ ...input, includeToday: true }))).status).toBe(
    429,
  );
  expect(loadAssistantTodayContext).not.toHaveBeenCalled();
});

// Source cases authored for the later consolidated QA pass.
it("withholds a provider reply after the actor moves household", async () => {
  (authenticateWithFamily as jest.Mock)
    .mockResolvedValueOnce([
      { user: { id: "a", role: "parent", family_id: "family-a" } },
      null,
    ])
    .mockResolvedValueOnce([
      { user: { id: "a", role: "parent", family_id: "family-b" } },
      null,
    ]);
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual(
    expect.objectContaining({ code: "ASSISTANT_SOURCE_CHANGED" }),
  );
});
it("withholds an answer if provider permission/configuration disappears while waiting", async () => {
  (resolveCaptureConfig as jest.Mock)
    .mockReturnValueOnce({ model: "test" })
    .mockReturnValueOnce(null);
  const response = await POST(request());
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body.reply).toBeUndefined();
  expect(body.action).toBeUndefined();
});

function freshTodayFixture() {
  return {
    protocol: "herewoven.assistant-today.v1",
    generatedAt: "2026-10-09T12:00:00.000Z",
    expiresAt: "2026-10-09T12:01:00.000Z",
    viewer: {
      role: "parent",
      localDate: "2026-10-09",
      timeZone: "America/Toronto",
    },
    today: {
      events: [],
      chores: [],
      dinner: null,
      groceries: [],
      useSoon: [],
      weather: null,
      unavailable: ["weather"],
    },
  };
}
it("withholds grounded output after a referenced record changes during provider latency", async () => {
  mockTodayEnabled = true;
  const context = freshTodayFixture();
  (loadAssistantTodayContext as jest.Mock)
    .mockResolvedValueOnce(context)
    .mockResolvedValueOnce({
      ...context,
      today: {
        ...context.today,
        groceries: [{ item: "Milk", quantity: 1, list: "Groceries" }],
      },
    });
  const response = await POST(request({ ...input, includeToday: true }));
  expect(response.status).toBe(409);
  expect((await response.json()).reply).toBeUndefined();
});
it("does not return expired grounded context even if all source values are unchanged", async () => {
  mockTodayEnabled = true;
  (loadAssistantTodayContext as jest.Mock).mockResolvedValue(
    freshTodayFixture(),
  );
  (structuredAssistantReply as jest.Mock).mockImplementationOnce(async () => {
    jest
      .mocked(Date.now)
      .mockReturnValue(Date.parse("2026-10-09T12:01:00.000Z"));
    return { reply: "Old household answer", action: null };
  });
  const response = await POST(request({ ...input, includeToday: true }));
  expect(response.status).toBe(409);
  expect((await response.json()).reply).toBeUndefined();
});

/** Authored/unrun catalog-bound response cases. */
function referenceFixture() {
  mockTodayEnabled = true;
  jest.mocked(isAssistantReferencesEnabled).mockReturnValue(true);
  jest.mocked(authenticateWithFamily).mockResolvedValue([
    {
      user: { id: "person-a", role: "parent", family_id: "family-a" },
      payload: { tv: 3 },
    },
    null,
  ] as never);
  const context = freshTodayFixture();
  const catalog = buildAssistantReferenceCatalog(
    [
      {
        kind: "chore",
        id: "task-a",
        index: 0,
        label: "Pack bag",
        versionInput: { epoch: 1 },
      },
    ],
    { userId: "person-a", familyId: "family-a", role: "parent", generation: 3 },
    context.generatedAt,
    "fabricated-reference-test-key",
  );
  const snapshot = {
    context: {
      ...context,
      today: {
        ...context.today,
        chores: [
          {
            title: "Pack bag",
            dueDay: "2026-10-09",
            status: "open",
            assignee: "A household member",
          },
        ],
      },
    },
    catalog,
  };
  jest
    .mocked(loadReferencedAssistantToday)
    .mockResolvedValue(snapshot as never);
  jest.mocked(structuredAssistantReply).mockResolvedValue({
    reply: "Pack bag is on Today",
    action: null,
    basis: "context",
    references: [catalog[0].provider.ref],
  });
  return snapshot;
}
it("returns only server-built current evidence and keeps actual record identity out of provider input", async () => {
  const snapshot = referenceFixture();
  const response = await POST(request({ ...input, includeToday: true }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    reply: "Pack bag is on Today",
    action: null,
    evidence: [snapshot.catalog[0].evidence],
  });
  expect(loadReferencedAssistantToday).toHaveBeenCalledTimes(2);
  const references = jest.mocked(structuredAssistantReply).mock.calls[0][4];
  expect(references).toEqual(snapshot.catalog.map((entry) => entry.provider));
  expect(JSON.stringify(references)).not.toMatch(
    /task-a|person-a|family-a|dashboard/,
  );
});
it("rejects fabricated references instead of displaying the provider claim", async () => {
  referenceFixture();
  jest.mocked(structuredAssistantReply).mockResolvedValue({
    reply: "Fabricated household claim",
    action: null,
    basis: "context",
    references: [`asr1_${"0".repeat(64)}`],
  });
  const response = await POST(request({ ...input, includeToday: true }));
  expect(response.status).toBe(502);
  expect((await response.json()).reply).toBeUndefined();
});
it("withholds unchanged display values when canonical source revision changed", async () => {
  const snapshot = referenceFixture();
  jest
    .mocked(loadReferencedAssistantToday)
    .mockResolvedValueOnce(snapshot as never)
    .mockResolvedValueOnce({
      ...snapshot,
      catalog: [
        {
          ...snapshot.catalog[0],
          provider: {
            ...snapshot.catalog[0].provider,
            revision: "changed-source",
          },
        },
      ],
    } as never);
  const response = await POST(request({ ...input, includeToday: true }));
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body.reply).toBeUndefined();
  expect(body.evidence).toBeUndefined();
});

it("keeps the legacy response contract for clients that do not advertise reference support", async () => {
  referenceFixture();
  jest.mocked(loadReferencedAssistantToday).mockClear();
  jest
    .mocked(loadAssistantTodayContext)
    .mockResolvedValue(freshTodayFixture() as never);
  jest
    .mocked(structuredAssistantReply)
    .mockResolvedValue({ reply: "Current summary", action: null });
  const response = await POST({
    text: async () => JSON.stringify({ ...input, includeToday: true }),
    headers: new Headers(),
  } as NextRequest);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    reply: "Current summary",
    action: null,
  });
  expect(loadReferencedAssistantToday).not.toHaveBeenCalled();
});
