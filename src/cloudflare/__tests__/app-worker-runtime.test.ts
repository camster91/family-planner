import {
  APP_COMPUTE_POOL_MAX_ACTIVE,
  APP_COMPUTE_POOL_SIZE,
  appComputePoolName,
  createComputeConcurrencyGuard,
  createAppWorkerRouter,
  forwardToOpenNext,
  isNarrowIp,
  sanitizeIngressRequest,
} from "../app-worker-runtime";
import {
  LEGACY_PROXY_IP_HEADER,
  LEGACY_PROXY_SECRET_HEADER,
} from "../legacy-proxy-headers";

describe("Cloudflare compute worker boundary", () => {
  it("round-robins through four stable, non-user-derived object names", async () => {
    const names: string[] = [];
    const forwarded: Request[] = [];
    const namespace = {
      idFromName(name: string) {
        names.push(name);
        return name;
      },
      get(name: unknown) {
        return {
          async fetch(request: Request) {
            forwarded.push(request);
            return new Response("ok");
          },
        };
      },
    };
    const router = createAppWorkerRouter();

    for (let index = 0; index < APP_COMPUTE_POOL_SIZE + 1; index += 1) {
      await router.fetch(
        new Request("https://herewoven.test/api/auth/me", {
          headers: { cookie: `session-${index}`, "x-request-id": `${index}` },
        }),
        { APP_COMPUTE_POOL: namespace },
      );
    }

    expect(names).toEqual([
      "herewoven-compute-0",
      "herewoven-compute-1",
      "herewoven-compute-2",
      "herewoven-compute-3",
      "herewoven-compute-0",
    ]);
    expect(forwarded).toHaveLength(APP_COMPUTE_POOL_SIZE + 1);
    expect(forwarded[0].headers.get("cookie")).toBe("session-0");
    expect(forwarded[4].headers.get("x-request-id")).toBe("4");
    expect(names.every((name) => !name.includes("session"))).toBe(true);
  });

  it("does not cache or rewrite requests and preserves a one-shot body", async () => {
    const requests: Request[] = [];
    const namespace = {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (request: Request) => {
          requests.push(request);
          return new Response(request.body);
        },
      }),
    };
    const controller = new AbortController();
    const request = new Request("https://herewoven.test/api/messages/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "session=fixture",
      },
      body: JSON.stringify({ text: "keep this exact body" }),
      signal: controller.signal,
    });

    const response = await createAppWorkerRouter().fetch(request, {
      APP_COMPUTE_POOL: namespace,
    });

    expect(requests[0]).not.toBe(request);
    expect(requests[0].url).toBe(request.url);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers.get("content-type")).toBe("application/json");
    expect(requests[0].headers.get("cookie")).toBe("session=fixture");
    controller.abort();
    expect(requests[0].signal.aborted).toBe(true);
    expect(await response.text()).toBe(
      JSON.stringify({ text: "keep this exact body" }),
    );
  });

  it("uses the platform IP and request URL host for normal requests", () => {
    const request = new Request("https://herewoven.test/api/auth/me", {
      headers: {
        "cf-connecting-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.99, 10.0.0.7",
        "x-real-ip": "198.51.100.99",
        "x-forwarded-host": "attacker.example",
        [LEGACY_PROXY_SECRET_HEADER]: "wrong",
        [LEGACY_PROXY_IP_HEADER]: "198.51.100.8",
      },
    });

    const sanitized = sanitizeIngressRequest(request, {
      LEGACY_PROXY_SECRET: "shared-secret",
    });

    expect(sanitized.headers.get("x-forwarded-for")).toBe("203.0.113.9");
    expect(sanitized.headers.get("x-real-ip")).toBe("203.0.113.9");
    expect(sanitized.headers.get("host")).toBe("herewoven.test");
    expect(sanitized.headers.get("x-forwarded-host")).toBe("herewoven.test");
    expect(sanitized.headers.get(LEGACY_PROXY_SECRET_HEADER)).toBeNull();
    expect(sanitized.headers.get(LEGACY_PROXY_IP_HEADER)).toBeNull();
  });

  it("removes spoofed forwarding headers when the platform has no IP", () => {
    const request = new Request("https://herewoven.test/api/auth/me", {
      headers: {
        "x-forwarded-for": "198.51.100.99",
        "x-real-ip": "198.51.100.99",
      },
    });

    const sanitized = sanitizeIngressRequest(request, {});

    expect(sanitized.headers.get("x-forwarded-for")).toBeNull();
    expect(sanitized.headers.get("x-real-ip")).toBeNull();
  });

  it("accepts original IP and host only from the authenticated legacy proxy", () => {
    const request = new Request("https://herewoven.com/api/auth/me", {
      headers: {
        "cf-connecting-ip": "10.0.0.5",
        "x-forwarded-for": "10.0.0.5",
        [LEGACY_PROXY_SECRET_HEADER]: "shared-secret",
        [LEGACY_PROXY_IP_HEADER]: "198.51.100.42",
        "x-forwarded-host": "family.ashbi.ca",
      },
    });

    const sanitized = sanitizeIngressRequest(request, {
      LEGACY_PROXY_SECRET: "shared-secret",
    });

    expect(sanitized.headers.get("x-forwarded-for")).toBe("198.51.100.42");
    expect(sanitized.headers.get("x-real-ip")).toBe("198.51.100.42");
    expect(sanitized.headers.get("host")).toBe("family.ashbi.ca");
    expect(sanitized.headers.get("x-forwarded-host")).toBe("family.ashbi.ca");
    expect(sanitized.headers.get(LEGACY_PROXY_SECRET_HEADER)).toBeNull();
    expect(sanitized.headers.get(LEGACY_PROXY_IP_HEADER)).toBeNull();
  });

  it("falls back to platform metadata when a proxy field is not narrow", () => {
    const request = new Request("https://herewoven.com/dashboard", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        [LEGACY_PROXY_SECRET_HEADER]: "shared-secret",
        [LEGACY_PROXY_IP_HEADER]: "198.51.100.42, 198.51.100.43",
        "x-forwarded-host": "family.ashbi.ca/path",
      },
    });

    const sanitized = sanitizeIngressRequest(request, {
      LEGACY_PROXY_SECRET: "shared-secret",
    });

    expect(sanitized.headers.get("x-forwarded-for")).toBe("203.0.113.10");
    expect(sanitized.headers.get("x-real-ip")).toBe("203.0.113.10");
    expect(sanitized.headers.get("host")).toBe("herewoven.com");
    expect(sanitized.headers.get("x-forwarded-host")).toBe("herewoven.com");
  });

  it("accepts canonical IPv6 addresses but rejects forwarding chains", () => {
    expect(isNarrowIp("2001:db8::42")).toBe(true);
    expect(isNarrowIp("2001:db8:0:0:0:0:0:42")).toBe(true);
    expect(isNarrowIp("::ffff:192.0.2.1")).toBe(true);
    expect(isNarrowIp("fffff::")).toBe(false);
    expect(isNarrowIp("1::2:")).toBe(false);
    expect(isNarrowIp("2001:db8::42, 198.51.100.1")).toBe(false);
    expect(isNarrowIp(" 198.51.100.1")).toBe(false);
  });

  it("fails closed without a compute binding and marks the response uncachable", async () => {
    const response = await createAppWorkerRouter().fetch(
      new Request("https://herewoven.test/dashboard"),
      {},
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("passes the request, environment, and bound waitUntil to OpenNext", async () => {
    const request = new Request("https://herewoven.test/api/auth/me");
    const env = { DB: { id: "canonical-d1" } };
    const waitUntil = jest.fn();
    const worker = {
      fetch: jest.fn(
        async (
          _request: Request,
          _env: unknown,
          context: { waitUntil: typeof waitUntil },
        ) => {
          context.waitUntil(Promise.resolve());
          return new Response("from-open-next");
        },
      ),
    };

    const response = await forwardToOpenNext(worker, request, env, {
      waitUntil,
    });

    expect(response.status).toBe(200);
    expect(worker.fetch).toHaveBeenCalledWith(
      request,
      env,
      expect.objectContaining({ waitUntil: expect.any(Function) }),
    );
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("refuses excess concurrent work without replaying the request", async () => {
    const guard = createComputeConcurrencyGuard();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = jest.fn(async () => {
      await blocker;
      return new Response("ok");
    });

    const active = Array.from({ length: APP_COMPUTE_POOL_MAX_ACTIVE }, () =>
      guard.run(work),
    );
    const overloaded = await guard.run(work);

    expect(overloaded.status).toBe(503);
    expect(overloaded.headers.get("cache-control")).toBe("no-store");
    expect(work).toHaveBeenCalledTimes(APP_COMPUTE_POOL_MAX_ACTIVE);

    release();
    await expect(Promise.all(active)).resolves.toHaveLength(
      APP_COMPUTE_POOL_MAX_ACTIVE,
    );
  });

  it("rejects any pool size other than the bounded four-object pool", () => {
    expect(() => createAppWorkerRouter(3)).toThrow(/exactly 4 objects/);
    expect(() => appComputePoolName(4)).toThrow(/between 0 and 3/);
  });
});
