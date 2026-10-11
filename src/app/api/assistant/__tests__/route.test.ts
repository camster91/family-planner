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
jest.mock("@/lib/capture", () => ({
  resolveCaptureConfig: jest.fn(() => ({ model: "test" })),
  structuredAssistantReply: jest.fn(),
  CaptureError: class extends Error {
    status = 502;
  },
}));
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
  ({ text: async () => JSON.stringify(body) }) as NextRequest;
beforeEach(() => {
  jest.clearAllMocks();
  mockTodayEnabled = false;
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
  expect((await POST(request())).status).toBe(503);
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
