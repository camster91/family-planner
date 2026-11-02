// OpenNext writes this generated module during `opennextjs-cloudflare build`.
// Wrangler bundles it once with this small entrypoint; it is not a second app
// implementation and remains the source of all route, auth, D1, R2, and asset
// behavior.
// @ts-expect-error The generated OpenNext module exists after the Cloudflare build.
import openNextWorker, {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "../../.open-next/worker.js";
import { DurableObject } from "cloudflare:workers";
import {
  createComputeConcurrencyGuard,
  createAppWorkerRouter,
  forwardToOpenNext,
} from "./app-worker-runtime.ts";

import { retiredCallingResponse, retireCallSocket, isRetiredCallingPath } from "./retired-calling.ts";
const appRouter = createAppWorkerRouter();

// Keep the deployed class export/migration identity for existing objects.
// The service is retired: no grants, provider calls, new sessions or signaling.
export class FamilyCallRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    for (const socket of ctx.getWebSockets()) retireCallSocket(socket);
  }
  fetch() { return retiredCallingResponse(); }
  webSocketMessage(socket) { retireCallSocket(socket); }
  webSocketClose(socket) { retireCallSocket(socket); }
  webSocketError(socket) { retireCallSocket(socket); }
}

/**
 * A stateless compute worker. It intentionally never reads or writes
 * `this.ctx.storage`, sets alarms, or caches responses. The application keeps
 * D1 as its canonical store and receives a header-sanitized request from the
 * public ingress boundary.
 */
export class HerewovenComputePool extends DurableObject {
  concurrencyGuard = createComputeConcurrencyGuard();

  async fetch(request) {
    return await this.concurrencyGuard.run(() =>
      forwardToOpenNext(openNextWorker, request, this.env, this.ctx),
    );
  }
}

export default {
  async fetch(request, env) {
    // Static assets still follow wrangler's existing `ASSETS` /
    // `run_worker_first` policy. Requests reaching the Worker are delegated
    // to the generated OpenNext handler through the bounded DO pool.
    const path = new URL(request.url).pathname;
    if (isRetiredCallingPath(path)) return retiredCallingResponse();
    return await appRouter.fetch(request, env);
  },
};

// Keep OpenNext's built-in class exports available to Wrangler and future
// cache configurations when this wrapper becomes the Worker entrypoint.
export { BucketCachePurge, DOQueueHandler, DOShardedTagCache };
