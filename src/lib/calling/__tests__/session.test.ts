import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateWithFamily } from "@/lib/api-auth";
import { validateCsrf } from "@/lib/csrf";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { callActorAllowed } from "../authority";
import { createCallingSession } from "../server";
import { verifyCallGrant } from "../grant";
jest.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: jest.fn(),
}));
jest.mock("@/lib/api-auth", () => ({ authenticateWithFamily: jest.fn() }));
jest.mock("@/lib/device-route", () => ({ authenticateDevice: jest.fn() }));
jest.mock("@/lib/device-http", () => ({ killSwitch: jest.fn() }));
jest.mock("@/lib/csrf", () => ({ validateCsrf: jest.fn() }));
jest.mock("@/lib/rate-limit-db", () => ({ checkRateLimit: jest.fn() }));
jest.mock("../authority", () => ({ callActorAllowed: jest.fn() }));
const origin = "https://herewoven.example.test";
const cookie = "fabricated-person-session";
const secret = "fabricated-calling-signature-secret-at-least-32-characters";
const turn = {
  iceServers: [
    {
      urls: ["turn:relay.example.test:3478"],
      username: "temporary-user",
      credential: "temporary-fixture-only",
    },
  ],
};
const fetchBefore = global.fetch;
const flagBefore = process.env.CALLING_ENABLED;
function request(body = JSON.stringify({ label: "Phone" }), host = origin) {
  return new NextRequest(origin + "/api/calls/session", {
    method: "POST",
    headers: {
      origin: host,
      cookie: `session_token=${cookie}`,
      "Content-Type": "application/json",
    },
    body,
  });
}
beforeEach(() => {
  jest.resetAllMocks();
  process.env.CALLING_ENABLED = "1";
  jest
    .mocked(getCloudflareContext)
    .mockReturnValue({
      env: {
        CALLING_ENABLED: "1",
        JWT_SECRET: secret,
        NEXT_PUBLIC_APP_URL: origin,
        CALLING_TURN_KEY_ID: "fixture-key",
        CALLING_TURN_API_TOKEN: "fixture-master-token",
        DB: {},
        FAMILY_CALLS: {},
      },
    } as never);
  jest.mocked(validateCsrf).mockReturnValue(null);
  jest
    .mocked(authenticateWithFamily)
    .mockResolvedValue([
      {
        user: { id: "person-a", family_id: "family-a", name: "Parent" },
        payload: { tv: 7 },
      },
      null,
    ] as never);
  jest.mocked(callActorAllowed).mockResolvedValue(true);
  jest.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  global.fetch = jest.fn(async () => Response.json(turn));
});
afterEach(() => {
  global.fetch = fetchBefore;
  if (flagBefore === undefined) delete process.env.CALLING_ENABLED;
  else process.env.CALLING_ENABLED = flagBefore;
});
it("does not authenticate or contact TURN while disabled", async () => {
  process.env.CALLING_ENABLED = "0";
  expect((await createCallingSession(request())).status).toBe(404);
  expect(authenticateWithFamily).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it("refuses another origin before authentication or TURN", async () => {
  expect(
    (
      await createCallingSession(
        request(undefined, "https://foreign.example.test"),
      )
    ).status,
  ).toBe(403);
  expect(authenticateWithFamily).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  ["{", 400],
  [JSON.stringify({ label: "x".repeat(3000) }), 413],
])(
  "bounds and validates session labels before TURN (%s)",
  async (body, status) => {
    expect((await createCallingSession(request(body))).status).toBe(status);
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("does not issue relay credentials to an actor that lost authority during provider access", async () => {
  jest
    .mocked(callActorAllowed)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  const response = await createCallingSession(request());
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "CALLING_NOT_ENABLED" });
});
it("refuses a rate-limited session without contacting TURN", async () => {
  jest.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
  expect((await createCallingSession(request())).status).toBe(429);
  expect(fetch).not.toHaveBeenCalled();
});
it("returns only temporary relay configuration and a cookie-bound household grant", async () => {
  const response = await createCallingSession(request());
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(data.iceServers).toEqual(turn.iceServers);
  expect(verifyCallGrant(data.grant, secret, origin, cookie)).toMatchObject({
    kind: "person",
    userId: "person-a",
    familyId: "family-a",
    generation: 7,
    label: "Parent · Phone",
  });
  expect(JSON.stringify(data)).not.toContain("fixture-master-token");
  expect(JSON.stringify(data)).not.toContain(secret);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(callActorAllowed).toHaveBeenCalledTimes(2);
});
