import { LocalPasswordCompute } from "../../../src/lib/cloudflare/password-compute-do";
import { testPasswordCompute } from "./password-compute";
import type { LocalPasswordComputeBinding } from "../../../src/lib/cloudflare/local-password-compute";

export { LocalPasswordCompute };

/** Local fixture harness only. The Durable Object itself has no fetch handler. */
export default {
  async fetch(
    request: Request,
    env: { PASSWORD_COMPUTE: LocalPasswordComputeBinding },
  ) {
    // Keep readiness separate from the deliberately expensive bcrypt12 run so
    // the smoke harness never queues multiple compute requests while Wrangler
    // is starting the local Worker.
    if (new URL(request.url).pathname === "/health")
      return Response.json({ ready: true });
    try {
      return Response.json(await testPasswordCompute(env.PASSWORD_COMPUTE));
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
  },
};
