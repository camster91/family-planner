import {
  signCallGrant,
  verifyCallGrant,
  callCookieHash,
  type CallGrant,
} from "../grant";
import { forwardCallingSocket } from "../ingress";
const secret = "fabricated-calling-test-secret-at-least-32-characters";
const origin = "https://herewoven.example.test",
  cookie = "fabricated-session-cookie";
const grant: CallGrant = {
  purpose: "family-call-v1",
  kind: "person",
  userId: "person-a",
  familyId: "family-a",
  generation: 0,
  label: "Parent · Phone",
  endpointId: "a658b019-9f86-44aa-9119-c444760d5562",
  origin,
  cookieHash: callCookieHash(cookie),
  issuedAt: 1000,
  expiresAt: 61000,
};
it("binds a 60-second grant to the exact cookie, purpose, origin and expiry", () => {
  const signed = signCallGrant(grant, secret);
  expect(verifyCallGrant(signed, secret, origin, cookie, 1001)).toEqual(grant);
  expect(
    verifyCallGrant(signed, secret, origin, "different-cookie", 1001),
  ).toBeNull();
  expect(
    verifyCallGrant(
      signed,
      secret,
      "https://elsewhere.example.test",
      cookie,
      1001,
    ),
  ).toBeNull();
  expect(verifyCallGrant(signed, secret, origin, cookie, 61000)).toBeNull();
  expect(
    verifyCallGrant(signed + "x", secret, origin, cookie, 1001),
  ).toBeNull();
  expect(verifyCallGrant(signed, secret, origin, cookie, 999)).toBeNull();
  expect(
    verifyCallGrant(
      signCallGrant({ ...grant, expiresAt: 62000 }, secret),
      secret,
      origin,
      cookie,
      1001,
    ),
  ).toBeNull();
});
it("routes the verified household, not a supplied room or query parameter", async () => {
  const now = Date.now(),
    token = signCallGrant(
      { ...grant, issuedAt: now, expiresAt: now + 60000 },
      secret,
    );
  const fetch = jest.fn(async () => new Response(null, { status: 200 })),
    name = jest.fn((x) => x);
  const env = {
    CALLING_ENABLED: "1",
    NEXT_PUBLIC_APP_URL: origin,
    JWT_SECRET: secret,
    FAMILY_CALLS: { idFromName: name, get: () => ({ fetch }) },
  };
  const request = new Request(origin + "/api/calls/socket?family=foreign", {
    headers: {
      Origin: origin,
      Upgrade: "websocket",
      Cookie: `session_token=${cookie}`,
      "Sec-WebSocket-Protocol": `herewoven.calls.v1, ${token}`,
    },
  });
  expect((await forwardCallingSocket(request, env)).status).toBe(200);
  expect(name).toHaveBeenCalledWith("family-calls-v1:family-a");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    (
      await forwardCallingSocket(
        new Request(request, {
          headers: {
            ...Object.fromEntries(request.headers),
            origin: "https://foreign.example.test",
          },
        }),
        env,
      )
    ).status,
  ).toBe(403);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    (
      await forwardCallingSocket(
        new Request(request, {
          headers: {
            ...Object.fromEntries(request.headers),
            cookie: `session_token=${cookie}; fp_device=paired-cookie`,
          },
        }),
        env,
      )
    ).status,
  ).toBe(403);
});
