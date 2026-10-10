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
