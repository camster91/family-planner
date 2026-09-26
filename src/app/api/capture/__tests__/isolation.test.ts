// Two-household isolation for /api/capture (#102): a family's own AI provider
// settings (and key) are only ever used for that family's members.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/rate-limit-db", () => require("@/__tests__/helpers/two-household").rateLimitMock);

import { GET, POST } from "../route";
import { encryptSecret } from "@/lib/secret-box";
import { db, req } from "@/__tests__/helpers/two-household";

describe("capture — two households", () => {
  const savedKey = process.env.CAPTURE_AI_KEY;
  const fetchSpy = jest.fn();

  beforeAll(() => {
    delete process.env.CAPTURE_AI_KEY;
    (global as any).fetch = fetchSpy;
  });
  afterAll(() => {
    if (savedKey !== undefined) process.env.CAPTURE_AI_KEY = savedKey;
  });
  beforeEach(() => {
    db.reset();
    fetchSpy.mockReset();
    const b = db.find("family", "family-B")!;
    b.capture_ai_key_enc = encryptSecret("sk-family-b-secret-key");
    b.capture_ai_model = "model-b";
  });

  it("returns 401 without a session", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await POST(req({ body: { text: "dentist tuesday" } }))).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("family A does not inherit family B's configured key", async () => {
    const status = await (await GET(req({ as: "parentA" }))).json();
    expect(status).toEqual({ configured: false, model: null, allowed: true });

    const res = await POST(req({ as: "teenA", body: { text: "dentist tuesday" } }));
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("family B sees its own configuration", async () => {
    const status = await (await GET(req({ as: "parentB" }))).json();
    expect(status).toEqual({ configured: true, model: "model-b", allowed: true });
  });

  it("D4: a child is refused with 'Ask a parent to add this.' and the key is never used", async () => {
    const res = await POST(req({ as: "childB", body: { text: "dentist tuesday" } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Ask a parent to add this." });
    expect(fetchSpy).not.toHaveBeenCalled();

    const status = await (await GET(req({ as: "childB" }))).json();
    expect(status).toEqual({
      configured: true,
      model: "model-b",
      allowed: false,
      message: "Ask a parent to add this.",
    });
  });

  it("D4: a teen may use capture (reaches the family's provider)", async () => {
    const a = db.find("family", "family-A")!;
    a.capture_ai_key_enc = encryptSecret("sk-family-a-secret-key");
    a.capture_ai_model = "model-a";
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ kind: "grocery", title: "milk" }) } }] }),
    });
    const res = await POST(req({ as: "teenA", body: { text: "milk" } }));
    expect(res.status).not.toBe(403);
    expect(fetchSpy).toHaveBeenCalled();
  });
});
