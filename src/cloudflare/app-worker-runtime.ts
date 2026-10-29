/**
 * Small, dependency-free pieces shared by the Cloudflare Worker wrapper and
 * its tests. Keeping the routing policy here makes it possible to exercise
 * the security and lifecycle boundary without importing the generated
 * OpenNext bundle in Jest.
 */

export const APP_COMPUTE_POOL_SIZE = 4;
export const APP_COMPUTE_POOL_MAX_ACTIVE = 8;
const APP_COMPUTE_POOL_PREFIX = "herewoven-compute";

export type ComputePoolStub = {
  fetch(request: Request): Response | Promise<Response>;
};

export type ComputePoolNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): ComputePoolStub;
};

export type AppWorkerEnvironment = {
  APP_COMPUTE_POOL?: ComputePoolNamespace;
};

export type OpenNextExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export type OpenNextWorker = {
  fetch(
    request: Request,
    env: unknown,
    ctx: OpenNextExecutionContext,
  ): Response | Promise<Response>;
};

export type ComputeWork = () => Response | Promise<Response>;

function overloadedComputeResponse(): Response {
  return new Response("The app compute object is busy", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "1",
    },
  });
}

/**
 * Refuse excess work instead of allowing an object-local queue to grow
 * without bound. This guard does not retry or replay a request, which is
 * important for non-idempotent household writes.
 */
export function createComputeConcurrencyGuard(
  maxActive = APP_COMPUTE_POOL_MAX_ACTIVE,
) {
  if (maxActive !== APP_COMPUTE_POOL_MAX_ACTIVE) {
    throw new RangeError(
      `Each compute object must allow exactly ${APP_COMPUTE_POOL_MAX_ACTIVE} active requests`,
    );
  }

  let active = 0;

  return {
    async run(work: ComputeWork): Promise<Response> {
      if (active >= maxActive) return overloadedComputeResponse();

      active += 1;
      try {
        return await work();
      } finally {
        active -= 1;
      }
    },
  };
}

export function appComputePoolName(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= APP_COMPUTE_POOL_SIZE) {
    throw new RangeError(
      `Compute pool index must be between 0 and ${APP_COMPUTE_POOL_SIZE - 1}`,
    );
  }
  return `${APP_COMPUTE_POOL_PREFIX}-${index}`;
}

/**
 * Create the public request router.
 *
 * The cursor is intentionally isolate-local and contains no household,
 * session, URL, or cookie data. The Durable Objects are compute-only: the
 * request is forwarded unchanged and the app continues to use its canonical
 * D1/R2 bindings inside the OpenNext worker.
 */
export function createAppWorkerRouter(poolSize = APP_COMPUTE_POOL_SIZE) {
  if (poolSize !== APP_COMPUTE_POOL_SIZE) {
    throw new RangeError(
      `The app compute pool must contain exactly ${APP_COMPUTE_POOL_SIZE} objects`,
    );
  }

  let nextPoolIndex = 0;

  return {
    async fetch(
      request: Request,
      env: AppWorkerEnvironment,
    ): Promise<Response> {
      const namespace = env.APP_COMPUTE_POOL;
      if (!namespace) {
        return new Response("The app compute pool is unavailable", {
          status: 503,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          },
        });
      }

      const index = nextPoolIndex;
      nextPoolIndex = (nextPoolIndex + 1) % poolSize;
      const stub = namespace.get(
        namespace.idFromName(appComputePoolName(index)),
      );

      // Do not clone, read, cache, or rewrite the request. This preserves
      // cookies, auth headers, body streams, abort signals, and method.
      return await stub.fetch(request);
    },
  };
}

/**
 * The generated OpenNext handler only needs waitUntil from the execution
 * context on this path. A narrow adapter avoids exposing Durable Object
 * storage or object lifecycle methods to application code.
 */
export async function forwardToOpenNext(
  worker: OpenNextWorker,
  request: Request,
  env: unknown,
  durableObjectContext: Pick<OpenNextExecutionContext, "waitUntil">,
): Promise<Response> {
  return await worker.fetch(request, env, {
    waitUntil: durableObjectContext.waitUntil.bind(durableObjectContext),
  });
}
