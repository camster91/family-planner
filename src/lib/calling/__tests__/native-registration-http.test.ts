import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateWithFamily } from "@/lib/api-auth";
import { validateCsrf } from "@/lib/csrf";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { callActorAllowed } from "../authority";
import * as repository from "../native-installations";
import { nativeRegistrationHttp } from "../native-registration-http";
jest.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: jest.fn(),
}));
jest.mock("@/lib/api-auth", () => ({ authenticateWithFamily: jest.fn() }));
jest.mock("@/lib/csrf", () => ({ validateCsrf: jest.fn() }));
jest.mock("@/lib/rate-limit-db", () => ({ checkRateLimit: jest.fn() }));
jest.mock("../authority", () => ({ callActorAllowed: jest.fn() }));
const origin = "https://herewoven.example.test",
  owner = {
    userId: "fixture-person",
    familyId: "fixture-family",
    generation: 0,
  };
const before = [
  process.env.CALLING_ENABLED,
  process.env.CALLING_NATIVE_REGISTRATION_ENABLED,
];
let env: Record<string, unknown>;
const input = () => ({
  protocol: "herewoven.native-calls.v1",
  commandId: "4ec4b5cd-b8fe-446c-85d6-daf1c3c08dfc",
  issuedAt: Date.now(),
  installationId: "f8368bc3-776f-47c5-8afc-83aaac52ac46",
  owner,
  expected: null,
  label: "Fixture phone",
  platform: "android",
  provider: "fcm",
  token: "fabricated-routing-token",
});
const request = (method = "GET", body?: unknown, requestOrigin = origin) =>
  new NextRequest(origin + "/api/calls/installations", {
    method,
    headers: { origin: requestOrigin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  process.env.CALLING_ENABLED = "1";
  process.env.CALLING_NATIVE_REGISTRATION_ENABLED = "1";
  env = {
    DB: {},
    CALLING_ENABLED: "1",
    CALLING_NATIVE_REGISTRATION_ENABLED: "1",
    NEXT_PUBLIC_APP_URL: origin,
    NATIVE_CALL_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
  };
  jest.mocked(getCloudflareContext).mockReturnValue({ env } as never);
  jest.mocked(authenticateWithFamily).mockResolvedValue([
    {
      user: { id: owner.userId, family_id: owner.familyId },
      payload: { tv: 0 },
    },
    null,
  ] as never);
  jest.mocked(callActorAllowed).mockResolvedValue(true);
  jest.mocked(validateCsrf).mockReturnValue(null);
  jest.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
});
afterAll(() => {
  for (const [index, key] of [
    "CALLING_ENABLED",
    "CALLING_NATIVE_REGISTRATION_ENABLED",
  ].entries()) {
    if (before[index] === undefined) delete process.env[key];
    else process.env[key] = before[index];
  }
});
it("is disabled by default without reading identity, storage or routing material", async () => {
  delete process.env.CALLING_NATIVE_REGISTRATION_ENABLED;
  expect((await nativeRegistrationHttp(request())).status).toBe(404);
  expect(authenticateWithFamily).not.toHaveBeenCalled();
  expect(getCloudflareContext).not.toHaveBeenCalled();
});
it("preserves CSRF and paired-device authentication refusals", async () => {
  jest
    .mocked(validateCsrf)
    .mockReturnValue(NextResponse.json({ error: "csrf" }, { status: 403 }));
  expect((await nativeRegistrationHttp(request("PUT", input()))).status).toBe(
    403,
  );
  expect(authenticateWithFamily).not.toHaveBeenCalled();
  jest.mocked(validateCsrf).mockReturnValue(null);
  jest
    .mocked(authenticateWithFamily)
    .mockResolvedValue([
      null,
      NextResponse.json({ error: "paired device refused" }, { status: 403 }),
    ] as never);
  expect((await nativeRegistrationHttp(request())).status).toBe(403);
  expect(callActorAllowed).not.toHaveBeenCalled();
});
it("lists only the canonical owner's registrations and never claims background readiness", async () => {
  const list = jest
    .spyOn(repository, "listNativeInstallations")
    .mockResolvedValue([]);
  const r = await nativeRegistrationHttp(request());
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({
    owner,
    backgroundRinging: false,
    installations: [],
  });
  expect(list).toHaveBeenCalledWith(env.DB, owner, expect.any(Number));
  expect(r.headers.get("Cache-Control")).toBe("private, no-store");
});
it("rejects stale authority, wrong origins, oversized bodies, missing encryption and throttling before storage", async () => {
  const register = jest
    .spyOn(repository, "registerNativeInstallation")
    .mockResolvedValue({} as never);
  jest.mocked(callActorAllowed).mockResolvedValueOnce(false);
  expect((await nativeRegistrationHttp(request())).status).toBe(403);
  expect(
    (
      await nativeRegistrationHttp(
        request("PUT", input(), "https://other.example.test"),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await nativeRegistrationHttp(
        request("PUT", { ...input(), token: "x".repeat(9000) }),
      )
    ).status,
  ).toBe(413);
  delete env.NATIVE_CALL_TOKEN_KEY;
  expect((await nativeRegistrationHttp(request("PUT", input()))).status).toBe(
    503,
  );
  jest.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
  expect((await nativeRegistrationHttp(request("PUT", input()))).status).toBe(
    429,
  );
  expect(register).not.toHaveBeenCalled();
});
it("passes a validated registration to the owned repository and exposes only its safe receipt", async () => {
  const register = jest
    .spyOn(repository, "registerNativeInstallation")
    .mockResolvedValue({
      installationId: input().installationId,
      backgroundRinging: false,
    } as never);
  const r = await nativeRegistrationHttp(request("PUT", input()));
  expect(r.status).toBe(200);
  expect(register).toHaveBeenCalledWith(
    env.DB,
    owner,
    expect.objectContaining({ token: "fabricated-routing-token" }),
    env.NATIVE_CALL_TOKEN_KEY,
    expect.any(Number),
  );
  expect(JSON.stringify(await r.json())).not.toContain(
    "fabricated-routing-token",
  );
});
it("refuses a delayed unregister from a different account before calling the repository", async () => {
  const remove = jest
    .spyOn(repository, "unregisterNativeInstallation")
    .mockResolvedValue(null);
  const data = {
    protocol: input().protocol,
    issuedAt: Date.now(),
    installationId: input().installationId,
    owner: { ...owner, userId: "other" },
    expected: { epoch: input().installationId, revision: 1 },
  };
  expect((await nativeRegistrationHttp(request("DELETE", data))).status).toBe(
    409,
  );
  expect(remove).not.toHaveBeenCalled();
});
