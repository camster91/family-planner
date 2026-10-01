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

jest.mock("@/lib/safe-fetch", () => {
  const actual = jest.requireActual("@/lib/safe-fetch");
  return { ...actual, safeFetch: jest.fn() };
});

import { POST } from "../route";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { assertPublicProviderUrl } from "@/lib/outbound-url";
import { CAPTURE_TIMEOUT_MS, MAX_IMAGE_BASE64_LENGTH } from "@/lib/capture";
import { safeFetch, UnsafeAddressError } from "@/lib/safe-fetch";
import { encryptSecret } from "@/lib/secret-box";

const mockAuth = authenticateWithFamily as jest.Mock;
const mockFamilyFindUnique = (prisma as any).family.findUnique as jest.Mock;
const mockCheckRateLimit = checkRateLimit as jest.Mock;
const mockAssertPublic = assertPublicProviderUrl as jest.Mock;
const mockSafeFetch = safeFetch as jest.Mock;

const ENV_KEYS = ["CAPTURE_AI_KEY", "CAPTURE_AI_BASE_URL", "CAPTURE_AI_MODEL"] as const;
const savedEnv: Record<string, string | undefined> = {};
const originalFetch = global.fetch;
const mockFetch = jest.fn();

const parentA = { id: "parent-a", family_id: "family-A", role: "parent", name: "Parent A", last_chore_date: null };

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return { json: async () => body, headers: new Headers(headers) } as any;
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

describe("POST /api/capture — size cap and provider timeout", () => {
  const originalFetch2 = global.fetch;

  beforeAll(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch2;
    delete process.env.CAPTURE_AI_KEY;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CAPTURE_AI_KEY = "server-env-key";
    mockAuth.mockResolvedValue([{ payload: { userId: "parent-a" }, user: parentA }, null]);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0, remaining: 29 });
    mockFamilyFindUnique.mockResolvedValue({ capture_ai_key_enc: null, capture_ai_base_url: null, capture_ai_model: null });
    mockFetch.mockResolvedValue(modelReply({ events: [], confidence: "low" }));
  });

  it("refuses an imageBase64 longer than the cap with 413 and no provider call", async () => {
    const res = await POST(makeRequest({ imageBase64: "A".repeat(MAX_IMAGE_BASE64_LENGTH + 1), mimeType: "image/png" }));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/too large/i) });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accepts an image exactly at the cap", async () => {
    const res = await POST(makeRequest({ imageBase64: "A".repeat(MAX_IMAGE_BASE64_LENGTH), mimeType: "image/png" }));

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a declared oversized body before parsing it", async () => {
    const json = jest.fn();
    const res = await POST({ json, headers: new Headers({ "content-length": String(50 * 1024 * 1024) }) } as any);

    expect(res.status).toBe(413);
    expect(json).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("passes an abort signal to the provider call", async () => {
    await POST(makeRequest({ text: "Dentist tomorrow at 3pm" }));

    const [, init] = mockFetch.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(CAPTURE_TIMEOUT_MS).toBe(30_000);
  });

  it("turns a provider timeout into a friendly 504", async () => {
    mockFetch.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

    const res = await POST(makeRequest({ text: "Dentist tomorrow at 3pm" }));

    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/took too long/i);
  });

  it("turns a timeout while reading the body into the same 504", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });

    const res = await POST(makeRequest({ text: "Dentist tomorrow at 3pm" }));

    expect(res.status).toBe(504);
  });

  it("a plain network failure stays a generic 500", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    const res = await POST(makeRequest({ text: "Dentist tomorrow at 3pm" }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Capture failed. Try again shortly.");
  });
});

describe("POST /api/capture — a family's own base URL is fetched with DNS pinning", () => {
  const originalFetch3 = global.fetch;

  beforeAll(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch3;
    delete process.env.CAPTURE_AI_KEY;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CAPTURE_AI_KEY;
    mockAuth.mockResolvedValue([{ payload: { userId: "parent-a" }, user: parentA }, null]);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0, remaining: 29 });
    mockFamilyFindUnique.mockResolvedValue({
      capture_ai_key_enc: encryptSecret("sk-family-own-key"),
      capture_ai_base_url: "https://llm.family.example/v1",
      capture_ai_model: "family-model",
    });
    mockAssertPublic.mockResolvedValue(undefined);
    mockSafeFetch.mockResolvedValue(modelReply({ kind: "event", title: "Dentist", confidence: "high" }));
  });

  it("vets the URL and then calls it through safeFetch, never the plain global fetch", async () => {
    const res = await POST(makeRequest({ text: "Dentist tomorrow at 3pm" }));

    expect(res.status).toBe(200);
    expect(mockAssertPublic).toHaveBeenCalledWith("https://llm.family.example/v1");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockSafeFetch.mock.calls[0];
    expect(url).toBe("https://llm.family.example/v1/chat/completions");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers.Authorization).toBe("Bearer sk-family-own-key");
  });

  it("turns a connect-time private address (DNS rebinding) into a 400", async () => {
    mockSafeFetch.mockRejectedValue(new UnsafeAddressError());

    const res = await POST(makeRequest({ text: "Dentist tomorrow at 3pm" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/public address/i);
  });
});
