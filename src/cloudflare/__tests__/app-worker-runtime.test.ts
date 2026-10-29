import {
  APP_COMPUTE_POOL_MAX_ACTIVE,
  APP_COMPUTE_POOL_SIZE,
  appComputePoolName,
  createComputeConcurrencyGuard,
  createAppWorkerRouter,
  forwardToOpenNext,
} from "../app-worker-runtime";

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
    const request = new Request("https://herewoven.test/api/messages/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "keep this exact body" }),
    });

    const response = await createAppWorkerRouter().fetch(request, {
      APP_COMPUTE_POOL: namespace,
    });

    expect(requests[0]).toBe(request);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers.get("content-type")).toBe("application/json");
    expect(await response.text()).toBe(
      JSON.stringify({ text: "keep this exact body" }),
    );
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
