// Provider HTTP guard (#264): fixed hosts only, no redirects, bounded
// 429/503 backoff honouring Retry-After. fetch is always a jest mock.

import {
  assertProviderUrl,
  ensureOk,
  parseRetryAfter,
  providerFetch,
  ProviderHttpError,
} from "../http";

const ok = () => new Response("{}", { status: 200 });

describe("assertProviderUrl", () => {
  it.each([
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    "https://oauth2.googleapis.com/token",
    "https://graph.microsoft.com/v1.0/me/calendars",
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  ])("allows %s", (url) => {
    expect(() => assertProviderUrl(url)).not.toThrow();
  });

  it.each([
    "http://www.googleapis.com/calendar/v3",
    "https://evil.example.com/calendar/v3",
    "https://www.googleapis.com.evil.example/x",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "https://www.googleapis.com:8443/x",
    "https://user:pass@graph.microsoft.com/v1.0/me",
    "file:///etc/passwd",
    "not a url",
  ])("refuses %s", (url) => {
    expect(() => assertProviderUrl(url)).toThrow(ProviderHttpError);
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates", () => {
    const now = Date.parse("2026-09-28T12:00:00Z");
    expect(parseRetryAfter("7", now)).toBe(7000);
    expect(parseRetryAfter("Mon, 28 Sep 2026 12:00:30 GMT", now)).toBe(30000);
    expect(parseRetryAfter("garbage", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
});

describe("providerFetch", () => {
  it("never calls fetch for a disallowed host", async () => {
    const fetchImpl = jest.fn(async () => ok());
    await expect(
      providerFetch("https://attacker.example/x", {}, { fetchImpl }),
    ).rejects.toMatchObject({ code: "blocked_host" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries 429 after Retry-After, then succeeds", async () => {
    const sleep = jest.fn(async () => undefined);
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(ok());
    const res = await providerFetch("https://graph.microsoft.com/v1.0/me", {}, { fetchImpl, sleep });
    expect(res.status).toBe(200);
    expect(sleep.mock.calls).toEqual([[2000], [2000]]); // Retry-After, then exponential (attempt 1)
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("gives up after a bounded number of retries", async () => {
    const sleep = jest.fn(async () => undefined);
    const fetchImpl = jest.fn(async () => new Response("", { status: 429, headers: { "retry-after": "1" } }));
    await expect(
      providerFetch("https://www.googleapis.com/x", {}, { fetchImpl, sleep, maxRetries: 3 }),
    ).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("does not wait out a Retry-After longer than the cap", async () => {
    const sleep = jest.fn(async () => undefined);
    const fetchImpl = jest.fn(async () => new Response("", { status: 429, headers: { "retry-after": "3600" } }));
    await expect(
      providerFetch("https://www.googleapis.com/x", {}, { fetchImpl, sleep }),
    ).rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 3600000 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("refuses to follow redirects", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response("", { status: 302, headers: { location: "http://169.254.169.254/" } }),
    );
    await expect(
      providerFetch("https://www.googleapis.com/x", {}, { fetchImpl }),
    ).rejects.toMatchObject({ code: "http", status: 302 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps network failures without echoing details", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("connect ECONNREFUSED token=abc");
    });
    const err = await providerFetch("https://www.googleapis.com/x", {}, { fetchImpl }).catch((e) => e);
    expect(err).toMatchObject({ code: "network" });
    expect(String(err.message)).not.toContain("token");
  });
});

describe("ensureOk", () => {
  const googleError = (reason: string) =>
    new Response(
      JSON.stringify({ error: { code: 403, errors: [{ reason, domain: "usageLimits" }] } }),
      { status: 403 },
    );

  it.each(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"])(
    "a Google 403 %s is a rate limit",
    async (reason) => {
      await expect(ensureOk(googleError(reason))).rejects.toMatchObject({ code: "rate_limited", status: 403 });
    },
  );

  it("a Google 403 for a missing scope is insufficient_scope", async () => {
    await expect(ensureOk(googleError("insufficientPermissions"))).rejects.toMatchObject({
      code: "insufficient_scope",
    });
    const scope = new Response(
      JSON.stringify({ error: { status: "PERMISSION_DENIED", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }),
      { status: 403 },
    );
    await expect(ensureOk(scope)).rejects.toMatchObject({ code: "insufficient_scope" });
  });

  it("any other 403 stays a plain http error, and the body is not in the message", async () => {
    const err = await ensureOk(googleError("forbidden SECRET-BODY")).catch((e) => e);
    expect(err).toMatchObject({ code: "http", status: 403 });
    expect(String(err.message)).not.toContain("SECRET-BODY");
  });

  it("401 is unauthorized; 2xx passes through", async () => {
    await expect(ensureOk(new Response("", { status: 401 }))).rejects.toMatchObject({ code: "unauthorized" });
    const ok = new Response("{}", { status: 200 });
    await expect(ensureOk(ok)).resolves.toBe(ok);
  });
});
