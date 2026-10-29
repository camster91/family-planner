import {
  ALLOWED_UPSTREAM_ORIGINS,
  handleLegacyAliasRequest,
} from "../legacy-alias-worker";
import {
  LEGACY_PROXY_IP_HEADER,
  LEGACY_PROXY_SECRET_HEADER,
} from "../legacy-proxy-headers";

const env = {
  LEGACY_PROXY_SECRET: "fixture-secret",
  HEREWOVEN_UPSTREAM_ORIGIN: ALLOWED_UPSTREAM_ORIGINS[0],
};

describe("legacy ashbi.ca alias Worker", () => {
  it("streams the original request to the allowed upstream with controlled hop headers", async () => {
    let targetRequest: Request | undefined;
    const upstream = async (request: Request) => {
      targetRequest = request;
      return new Response("created", { status: 201 });
    };

    const request = new Request(
      "https://family.ashbi.ca/api/events?day=2026-10-29&view=week",
      {
        method: "POST",
        headers: {
          authorization: "Bearer fixture-token",
          cookie: "session=fixture-session",
          "cf-connecting-ip": "203.0.113.10",
          "x-forwarded-host": "spoofed.example",
          "x-herewoven-client-ip": "spoofed-ip",
        },
        body: JSON.stringify({ title: "Dinner" }),
      },
    );

    const response = await handleLegacyAliasRequest(request, env, upstream);

    expect(response.status).toBe(201);
    expect(targetRequest).toBeDefined();
    expect(targetRequest?.url).toBe(
      "https://herewoven.com/api/events?day=2026-10-29&view=week",
    );
    expect(targetRequest?.method).toBe("POST");
    expect(targetRequest?.headers.get("authorization")).toBe(
      "Bearer fixture-token",
    );
    expect(targetRequest?.headers.get("cookie")).toBe(
      "session=fixture-session",
    );
    expect(targetRequest?.headers.get("host")).toBeNull();
    expect(targetRequest?.headers.get("x-forwarded-host")).toBe(
      "family.ashbi.ca",
    );
    expect(targetRequest?.headers.get(LEGACY_PROXY_SECRET_HEADER)).toBe(
      "fixture-secret",
    );
    expect(targetRequest?.headers.get(LEGACY_PROXY_IP_HEADER)).toBe(
      "203.0.113.10",
    );
    expect(await targetRequest?.text()).toBe(
      JSON.stringify({ title: "Dinner" }),
    );
  });

  it("rewrites only owned absolute redirects and preserves duplicate cookies", async () => {
    const upstream = async () =>
      new Response("", {
        status: 302,
        headers: [
          ["location", "https://herewoven.com/login?return=/today#app"],
          ["set-cookie", "first=1; Path=/"],
          ["set-cookie", "second=2; Path=/; HttpOnly"],
        ],
      });

    const response = await handleLegacyAliasRequest(
      new Request("https://family.ashbi.ca/start"),
      env,
      upstream,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://family.ashbi.ca/login?return=/today#app",
    );
    const cookies = response.headers.getSetCookie?.() ?? [
      response.headers.get("set-cookie") ?? "",
    ];
    expect(cookies).toEqual(["first=1; Path=/", "second=2; Path=/; HttpOnly"]);
  });

  it("leaves external and relative redirects unchanged", async () => {
    for (const location of [
      "https://accounts.google.com/login",
      "/login?return=/today",
    ]) {
      const response = await handleLegacyAliasRequest(
        new Request("https://family.ashbi.ca/start"),
        env,
        async () => new Response(null, { status: 307, headers: { location } }),
      );
      expect(response.headers.get("location")).toBe(location);
    }
  });

  it("rewrites an owned protocol-relative redirect to the family origin", async () => {
    const request = new Request("https://family.ashbi.ca/start");
    const fetcher = jest.fn(async (received: Request) => {
      expect(received.url).toBe("https://herewoven.com/start");
      return new Response(null, {
        status: 307,
        headers: { location: "//herewoven.com/login?return=/today" },
      });
    });

    const response = await handleLegacyAliasRequest(request, env, fetcher);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://family.ashbi.ca/login?return=/today",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("also accepts the explicit QA Worker hostname", async () => {
    let targetURL = "";
    const response = await handleLegacyAliasRequest(
      new Request(
        "https://herewoven-legacy-alias.camster915391.workers.dev/today",
      ),
      { ...env, HEREWOVEN_UPSTREAM_ORIGIN: ALLOWED_UPSTREAM_ORIGINS[1] },
      async (request) => {
        targetURL = request.url;
        return new Response("qa", { status: 200 });
      },
    );

    expect(response.status).toBe(200);
    expect(targetURL).toBe(
      "https://herewoven.ashbi-design-preview.workers.dev/today",
    );
  });

  it("returns 404 without fetching for any other host", async () => {
    const fetcher = jest.fn();
    const response = await handleLegacyAliasRequest(
      new Request("https://legacy.ashbi.ca/api/auth/me"),
      env,
      fetcher,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed for missing secrets and unapproved upstream origins", async () => {
    const fetcher = jest.fn();

    const missingSecret = await handleLegacyAliasRequest(
      new Request("https://family.ashbi.ca/api/auth/me"),
      { ...env, LEGACY_PROXY_SECRET: "" },
      fetcher,
    );
    const unapprovedOrigin = await handleLegacyAliasRequest(
      new Request("https://family.ashbi.ca/api/auth/me"),
      { ...env, HEREWOVEN_UPSTREAM_ORIGIN: "https://example.com" },
      fetcher,
    );

    expect(missingSecret.status).toBe(503);
    expect(unapprovedOrigin.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a no-store gateway error when the upstream cannot be reached", async () => {
    const response = await handleLegacyAliasRequest(
      new Request("https://family.ashbi.ca/api/auth/me"),
      env,
      async () => {
        throw new Error("fixture upstream failure");
      },
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
