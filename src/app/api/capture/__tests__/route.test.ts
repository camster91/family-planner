// Route-level test for POST /api/capture: the deployment's CAPTURE_AI_KEY is
// only ever sent to the deployment endpoint. A family without its own key but
// with a custom capture_ai_base_url must not be able to redirect the server
// key to a host it controls.

jest.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: any) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => data,
    }),
  },
}));

jest.mock("@/lib/api-auth", () => ({
  authenticateWithFamily: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    family: { findUnique: jest.fn() },
  },
}));

jest.mock("@/lib/rate-limit-db", () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock("@/lib/outbound-url", () => ({
  assertPublicProviderUrl: jest.fn(),
}));

import { POST } from "../route";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { assertPublicProviderUrl } from "@/lib/outbound-url";

const mockAuth = authenticateWithFamily as jest.Mock;
const mockFamilyFindUnique = (prisma as any).family.findUnique as jest.Mock;
const mockCheckRateLimit = checkRateLimit as jest.Mock;
const mockAssertPublic = assertPublicProviderUrl as jest.Mock;

const ENV_KEYS = ["CAPTURE_AI_KEY", "CAPTURE_AI_BASE_URL", "CAPTURE_AI_MODEL"] as const;
const savedEnv: Record<string, string | undefined> = {};
const originalFetch = global.fetch;
const mockFetch = jest.fn();

const parentA = { id: "parent-a", family_id: "family-A", role: "parent", name: "Parent A", last_chore_date: null };

function makeRequest(body: unknown) {
  return { json: async () => body } as any;
}

function modelReply(content: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    text: async () => "",
  };
}

describe("POST /api/capture — server key never follows a family base URL", () => {
  beforeAll(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CAPTURE_AI_KEY = "server-env-key";
    delete process.env.CAPTURE_AI_BASE_URL;
    delete process.env.CAPTURE_AI_MODEL;
    mockAuth.mockResolvedValue([{ payload: { userId: "parent-a" }, user: parentA }, null]);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0, remaining: 29 });
    // No family key, but an attacker-chosen base URL and model.
    mockFamilyFindUnique.mockResolvedValue({
      capture_ai_key_enc: null,
      capture_ai_base_url: "https://evil.example",
      capture_ai_model: "evil-model",
    });
    mockFetch.mockResolvedValue(modelReply({ kind: "event", title: "Dentist", confidence: "high" }));
  });

  function assertNeverEvil() {
    for (const [url, init] of mockFetch.mock.calls) {
      expect(String(url)).not.toContain("evil.example");
      expect(JSON.stringify(init)).not.toContain("evil.example");
    }
  }

  it("uses the default provider URL with the env key (text capture)", async () => {
    const res = await POST(makeRequest({ text: "Dentist tomorrow at 3pm" }));

    expect(res.status).toBe(200);
    expect(mockFamilyFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "family-A" } })
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer server-env-key");
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(init.body).model).not.toBe("evil-model");
    // The env endpoint is trusted, so no user-URL vetting is involved.
    expect(mockAssertPublic).not.toHaveBeenCalled();
    assertNeverEvil();
  });

  it("uses CAPTURE_AI_BASE_URL from env when set, not the family URL", async () => {
    process.env.CAPTURE_AI_BASE_URL = "https://llm.deploy.example/v1/";
    process.env.CAPTURE_AI_MODEL = "deploy-model";

    const res = await POST(makeRequest({ text: "Soccer Saturday 10am" }));

    expect(res.status).toBe(200);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://llm.deploy.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer server-env-key");
    expect(JSON.parse(init.body).model).toBe("deploy-model");
    assertNeverEvil();
  });

  it("uses the env/default URL for image capture too", async () => {
    mockFetch.mockResolvedValue(modelReply({ events: [], confidence: "low" }));

    await POST(makeRequest({ imageBase64: "aGVsbG8=", mimeType: "image/png" }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
    assertNeverEvil();
  });

  it("reports 503 and makes no outbound call when there is neither a family nor env key", async () => {
    delete process.env.CAPTURE_AI_KEY;

    const res = await POST(makeRequest({ text: "Dentist tomorrow" }));

    expect(res.status).toBe(503);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
