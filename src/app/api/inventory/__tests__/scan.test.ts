// POST /api/inventory/scan (#265): kill switch, feature gate, roles (parent
// only), paired-device refusal, upload size/type checks, rate limits and the
// daily spend cap per household, provider failures and malformed output, and
// that nothing is written or logged beyond content-minimal metadata. The
// provider HTTP call is always mocked: no test reaches the network.

jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock(
  "next/headers",
  () => require("@/__tests__/helpers/two-household").nextHeadersMock,
);
jest.mock(
  "@/lib/session",
  () => require("@/__tests__/helpers/two-household").sessionMock,
);
jest.mock("@/lib/prisma", () => ({
  prisma: require("@/__tests__/helpers/two-household").fakePrisma,
}));
const mockGate = jest.fn(
  async (_familyId: string, _key: string): Promise<unknown> => null,
);
jest.mock("@/lib/feature-gate-server", () => ({
  featureGate: (familyId: string, key: string) => mockGate(familyId, key),
}));
// A real fixed-window counter per key, in memory, so limits can be exercised.
const mockCounts = new Map<string, number>();
const mockRateCalls: Array<{ key: string; max: number; windowMs: number }> = [];
jest.mock("@/lib/rate-limit-db", () => ({
  checkRateLimit: async (key: string, max: number, windowMs: number) => {
    mockRateCalls.push({ key, max, windowMs });
    const n = (mockCounts.get(key) ?? 0) + 1;
    mockCounts.set(key, n);
    return n > max
      ? { allowed: false, remaining: 0, retryAfterMs: 1_800_000 }
      : { allowed: true, remaining: max - n, retryAfterMs: 0 };
  },
}));

import { POST } from "../scan/route";
import {
  db,
  req,
  FOREIGN,
  type UserKey,
} from "@/__tests__/helpers/two-household";
import {
  deviceReq,
  enableSharedDevice,
  disableSharedDevice,
  seedDevices,
} from "@/__tests__/helpers/device";
import {
  INVENTORY_SCAN_ENDPOINT,
  INVENTORY_SCAN_MAX_BYTES,
} from "@/lib/inventory-scan";

const KEY = "sk-test-not-a-real-key";
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5,
]);
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2, 3,
]);
const HEIC = new Uint8Array([
  0,
  0,
  0,
  0x18,
  ...Buffer.from("ftypheic"),
  0,
  0,
  0,
  0,
]);
const GIF = new Uint8Array([...Buffer.from("GIF89a"), 1, 0, 1, 0]);
const TEXT = new Uint8Array(Buffer.from('<svg onload="alert(1)"></svg>'));

type Upload = {
  bytes?: Uint8Array;
  type?: string;
  field?: string;
  contentLength?: string | null;
  contentType?: string;
};

function scanReq(as: UserKey | null, upload: Upload = {}) {
  const bytes = upload.bytes ?? JPEG;
  const form = new FormData();
  form.append(
    upload.field ?? "image",
    new Blob([bytes as BlobPart], { type: upload.type ?? "image/jpeg" }),
    "fridge.jpg",
  );
  const headers: Record<string, string> = {
    "content-type":
      upload.contentType ?? "multipart/form-data; boundary=----test",
  };
  const length =
    upload.contentLength === undefined
      ? String(bytes.length + 200)
      : upload.contentLength;
  if (length !== null) headers["content-length"] = length;
  return {
    ...req({ as, method: "POST", path: "/api/inventory/scan", headers }),
    formData: async () => form,
  };
}

function providerJson(output: unknown, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    body: null,
    json: async () => ({
      id: "msg_test",
      type: "message",
      role: "assistant",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: typeof output === "string" ? output : JSON.stringify(output),
        },
      ],
      ...extra,
    }),
  };
}

const GOOD = {
  items: [
    {
      name: "Milk",
      amount: 2,
      unit: "L",
      location: "fridge",
      confidence: 0.94,
    },
    {
      name: "Eggs",
      amount: 6,
      unit: null,
      location: "fridge",
      confidence: 0.8,
    },
    {
      name: "Frozen peas",
      amount: null,
      unit: "bag",
      location: "freezer",
      confidence: 0.55,
    },
  ],
};

let fetchMock: jest.Mock;
const logs: string[] = [];
const realFetch = global.fetch;

beforeAll(() => {
  for (const level of ["log", "warn", "error", "info"] as const) {
    jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(
        args
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
          .join(" "),
      );
    });
  }
});
afterAll(() => {
  global.fetch = realFetch;
  delete process.env.INVENTORY_SCAN_ANTHROPIC_API_KEY;
  delete process.env.INVENTORY_SCAN_MODEL;
  delete process.env.INVENTORY_SCAN_DAILY_LIMIT;
});
beforeEach(() => {
  db.reset();
  mockGate.mockReset();
  mockGate.mockImplementation(async () => null);
  mockCounts.clear();
  mockRateCalls.length = 0;
  logs.length = 0;
  process.env.INVENTORY_SCAN_ANTHROPIC_API_KEY = KEY;
  delete process.env.INVENTORY_SCAN_MODEL;
  delete process.env.INVENTORY_SCAN_DAILY_LIMIT;
  fetchMock = jest.fn(async () => providerJson(GOOD));
  global.fetch = fetchMock as unknown as typeof fetch;
});

async function errorCode(res: any): Promise<string | undefined> {
  const body = await res.json();
  return body?.error?.code;
}

describe("POST /api/inventory/scan", () => {
  it("returns cleaned suggestions to a parent and writes nothing", async () => {
    const res = await POST(scanReq("parentA"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual({
      items: [
        {
          name: "Milk",
          amount: 2,
          unit: "L",
          location: "fridge",
          confidence: 0.94,
        },
        {
          name: "Eggs",
          amount: 6,
          unit: null,
          location: "fridge",
          confidence: 0.8,
        },
        {
          name: "Frozen peas",
          amount: null,
          unit: "bag",
          location: "freezer",
          confidence: 0.55,
        },
      ],
      dropped: 0,
    });
    expect(db.writes).toHaveLength(0);
  });

  it("calls only the fixed provider endpoint with the server key, the image and a JSON schema", async () => {
    process.env.INVENTORY_SCAN_MODEL = "claude-sonnet-5";
    await POST(scanReq("parentA", { bytes: PNG, type: "image/jpeg" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(INVENTORY_SCAN_ENDPOINT);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.redirect).toBe("manual");
    expect(init.headers["x-api-key"]).toBe(KEY);
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("claude-sonnet-5");
    expect(sent.output_config.format.type).toBe("json_schema");
    const image = sent.messages[0].content[0];
    // The sniffed type wins over the client-declared one.
    expect(image).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: Buffer.from(PNG).toString("base64"),
      },
    });
  });

  it("answers 404 and never calls the provider while no key is configured", async () => {
    delete process.env.INVENTORY_SCAN_ANTHROPIC_API_KEY;
    const res = await POST(scanReq("parentA"));
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("INVENTORY_SCAN_DISABLED");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockRateCalls).toHaveLength(0);
  });

  it("requires a session (401) before revealing whether the feature is configured", async () => {
    delete process.env.INVENTORY_SCAN_ANTHROPIC_API_KEY;
    expect((await POST(scanReq(null))).status).toBe(401);
    process.env.INVENTORY_SCAN_ANTHROPIC_API_KEY = KEY;
    expect((await POST(scanReq(null))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is refused when the household has the inventory feature off", async () => {
    mockGate.mockImplementation(async () => ({
      status: 403,
      json: async () => ({ error: "off" }),
      headers: new Headers(),
    }));
    const res = await POST(scanReq("parentA"));
    expect(res.status).toBe(403);
    expect(mockGate).toHaveBeenCalledWith("family-A", "inventory");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["teenA", "childA"] as UserKey[])(
    "refuses %s (parent only) before any rate-limit write or provider call",
    async (who) => {
      const res = await POST(scanReq(who));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toEqual({
        code: "INVENTORY_SCAN_FORBIDDEN",
        message: "Ask a parent to scan the fridge.",
        retryable: false,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockRateCalls).toHaveLength(0);
    },
  );

  it("refuses a paired shared device with 403 before person auth", async () => {
    enableSharedDevice();
    try {
      const fx = seedDevices();
      const csrf = "c".repeat(64);
      const res = await POST(
        deviceReq({
          method: "POST",
          path: "/api/inventory/scan",
          cookies: { ...fx.d1.cookies, csrf_token: csrf },
          headers: { "x-csrf-token": csrf },
          body: {},
        }),
      );
      expect(res.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      disableSharedDevice();
    }
  });

  describe("upload checks", () => {
    it("rejects a declared body over the limit with 413 before reading it", async () => {
      const r = scanReq("parentA", {
        contentLength: String(INVENTORY_SCAN_MAX_BYTES + 128 * 1024),
      });
      const formData = jest.fn(r.formData);
      const res = await POST({ ...r, formData });
      expect(res.status).toBe(413);
      expect(await errorCode(res)).toBe("IMAGE_TOO_LARGE");
      expect(formData).not.toHaveBeenCalled();
    });

    it("rejects a file over 8 MB with 413", async () => {
      const big = new Uint8Array(INVENTORY_SCAN_MAX_BYTES + 1);
      big.set(JPEG);
      const res = await POST(
        scanReq("parentA", {
          bytes: big,
          contentLength: String(INVENTORY_SCAN_MAX_BYTES + 1000),
        }),
      );
      expect(res.status).toBe(413);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("requires Content-Length (411) and a multipart body (400)", async () => {
      expect(
        (await POST(scanReq("parentA", { contentLength: null }))).status,
      ).toBe(411);
      const res = await POST(
        scanReq("parentA", { contentType: "application/json" }),
      );
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("INVALID_FORM");
    });

    it("requires the image field and a non-empty file", async () => {
      expect(
        await errorCode(await POST(scanReq("parentA", { field: "file" }))),
      ).toBe("INVALID_FORM");
      expect(
        await errorCode(
          await POST(scanReq("parentA", { bytes: new Uint8Array(0) })),
        ),
      ).toBe("INVALID_FORM");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ["HEIC (not accepted by the provider)", HEIC, "image/heic"],
      ["GIF", GIF, "image/gif"],
      ["SVG/text declared as JPEG", TEXT, "image/jpeg"],
    ])("rejects %s with 415 by magic bytes", async (_label, bytes, type) => {
      const res = await POST(scanReq("parentA", { bytes, type }));
      expect(res.status).toBe(415);
      expect(await errorCode(res)).toBe("UNSUPPORTED_IMAGE_TYPE");
      expect(fetchMock).not.toHaveBeenCalled();
      // A wrong file does not use up the quota.
      expect(mockRateCalls).toHaveLength(0);
    });
  });

  describe("rate limits and the daily spend cap", () => {
    it("limits one parent to 5 scans an hour (429 with Retry-After)", async () => {
      for (let i = 0; i < 5; i++)
        expect((await POST(scanReq("parentA"))).status).toBe(200);
      const res = await POST(scanReq("parentA"));
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("1800");
      expect(await errorCode(res)).toBe("RATE_LIMITED");
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it("limits a household to 10 scans an hour across parents", async () => {
      db.find("user", "teen-a")!.role = "parent";
      for (let i = 0; i < 5; i++)
        expect((await POST(scanReq("parentA"))).status).toBe(200);
      for (let i = 0; i < 5; i++)
        expect((await POST(scanReq("teenA"))).status).toBe(200);
      db.find("user", "child-a")!.role = "parent";
      const res = await POST(scanReq("childA"));
      expect(res.status).toBe(429);
      expect(await errorCode(res)).toBe("RATE_LIMITED");
      expect(fetchMock).toHaveBeenCalledTimes(10);
    });

    it("enforces INVENTORY_SCAN_DAILY_LIMIT per household per UTC day; another household is unaffected", async () => {
      process.env.INVENTORY_SCAN_DAILY_LIMIT = "2";
      expect((await POST(scanReq("parentA"))).status).toBe(200);
      expect((await POST(scanReq("parentA"))).status).toBe(200);
      const res = await POST(scanReq("parentA"));
      expect(res.status).toBe(429);
      expect(await errorCode(res)).toBe("SCAN_DAILY_LIMIT");
      expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);

      const other = await POST(scanReq("parentB"));
      expect(other.status).toBe(200);
      const day = new Date().toISOString().slice(0, 10);
      const dailyKeys = mockRateCalls
        .filter((c) => c.key.startsWith("inventory-scan:day:"))
        .map((c) => c.key);
      expect(new Set(dailyKeys)).toEqual(
        new Set([
          `inventory-scan:day:family-A:${day}`,
          `inventory-scan:day:family-B:${day}`,
        ]),
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("a daily limit of 0 blocks every scan without calling the provider", async () => {
      process.env.INVENTORY_SCAN_DAILY_LIMIT = "0";
      const res = await POST(scanReq("parentA"));
      expect(res.status).toBe(429);
      expect(await errorCode(res)).toBe("SCAN_DAILY_LIMIT");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("provider failures", () => {
    it.each([401, 429, 500, 529])(
      "maps an upstream %s to 502 SCAN_PROVIDER_UNAVAILABLE without echoing the body",
      async (status) => {
        fetchMock.mockResolvedValue({
          ok: false,
          status,
          body: { cancel: async () => undefined },
          json: async () => ({ error: { message: `upstream detail ${KEY}` } }),
          text: async () => `upstream detail ${KEY}`,
        });
        const res = await POST(scanReq("parentA"));
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.error.code).toBe("SCAN_PROVIDER_UNAVAILABLE");
        expect(body.error.retryable).toBe(true);
        expect(JSON.stringify(body)).not.toContain("upstream detail");
        expect(logs.join("\n")).not.toContain("upstream detail");
      },
    );

    it("maps a network failure or timeout to 502", async () => {
      fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
      const res = await POST(scanReq("parentA"));
      expect(res.status).toBe(502);
      expect(await errorCode(res)).toBe("SCAN_PROVIDER_UNAVAILABLE");
    });

    it.each([
      ["non-JSON text", "Sure! Here are the items: milk, eggs"],
      ["the wrong top-level shape", { things: ["milk"] }],
      ["items that is not an array", { items: "milk, eggs" }],
    ])("maps %s to 502 SCAN_UNREADABLE", async (_label, output) => {
      fetchMock.mockResolvedValue(providerJson(output));
      const res = await POST(scanReq("parentA"));
      expect(res.status).toBe(502);
      expect(await errorCode(res)).toBe("SCAN_UNREADABLE");
      expect(db.writes).toHaveLength(0);
    });

    it("maps a refusal stop reason to 502 SCAN_UNREADABLE", async () => {
      fetchMock.mockResolvedValue(
        providerJson("", { stop_reason: "refusal", content: [] }),
      );
      expect(await errorCode(await POST(scanReq("parentA")))).toBe(
        "SCAN_UNREADABLE",
      );
    });

    it("drops garbage items and cleans markup rather than failing the scan", async () => {
      fetchMock.mockResolvedValue(
        providerJson({
          items: [
            {
              name: "<img src=x onerror=alert(1)>Butter",
              amount: "1",
              unit: "block",
              location: "Fridge",
              confidence: 3,
            },
            {
              name: "   ",
              amount: 1,
              unit: null,
              location: "fridge",
              confidence: 0.9,
            },
            { name: 12, amount: 1 },
            {
              name: "1234",
              amount: 1,
              unit: null,
              location: "fridge",
              confidence: 0.9,
            },
            {
              name: "Jam",
              amount: -4,
              unit: "<b>",
              location: "garage",
              confidence: "high",
            },
          ],
        }),
      );
      const res = await POST(scanReq("parentA"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toEqual([
        {
          name: "img src=x onerror=alert(1) Butter",
          amount: 1,
          unit: "block",
          location: "fridge",
          confidence: 1,
        },
        {
          name: "Jam",
          amount: null,
          unit: "b",
          location: null,
          confidence: 0.5,
        },
      ]);
      expect(body.dropped).toBe(3);
      expect(JSON.stringify(body)).not.toMatch(/[<>]/);
    });
  });

  it("logs only content-minimal metadata: no image bytes, key or item names", async () => {
    await POST(scanReq("parentA"));
    fetchMock.mockResolvedValue(providerJson("not json at all: Milk"));
    await POST(scanReq("parentA"));
    const text = logs.join("\n");
    expect(text).toContain("inventory.scan");
    expect(text).not.toContain(Buffer.from(JPEG).toString("base64"));
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("Milk");
    expect(text).not.toContain("Frozen peas");
  });

  it("two households: a scan never returns or reads the other household", async () => {
    const res = await POST(scanReq("parentB"));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(FOREIGN);
    expect(mockGate).toHaveBeenCalledWith("family-B", "inventory");
    const keys = mockRateCalls.map((c) => c.key);
    expect(
      keys.every((k) => !k.includes("family-A") && !k.includes("parent-a")),
    ).toBe(true);
    // The route reads no household rows at all (suggestions only).
    expect(db.writes).toHaveLength(0);
  });
});
