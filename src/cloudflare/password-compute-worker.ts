import { LocalPasswordCompute } from "../lib/cloudflare/password-compute-do";
import {
  localPasswordComputeShardName,
  PASSWORD_COMPUTE_MAX_SECRET_LENGTH,
  PASSWORD_COMPUTE_SERVICE_PATH,
  type LocalPasswordComputeBinding,
} from "../lib/cloudflare/local-password-compute";

export { LocalPasswordCompute };

type PasswordComputeEnv = {
  PASSWORD_COMPUTE: LocalPasswordComputeBinding;
};

type PasswordComputeRequest = {
  operation?: unknown;
  secret?: unknown;
  encodedHash?: unknown;
  routingKey?: unknown;
};

function badRequest(): Response {
  return Response.json(
    { error: "Invalid password compute request" },
    { status: 400 },
  );
}

/**
 * Private Worker-to-Worker entrypoint. This worker has no public route in its
 * Wrangler config; the application reaches it only through a service binding.
 * The Durable Object performs the bcrypt12 work and stores no credential data.
 */
const passwordComputeWorker = {
  async fetch(request: Request, env: PasswordComputeEnv): Promise<Response> {
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== PASSWORD_COMPUTE_SERVICE_PATH
    )
      return new Response(null, { status: 404 });

    let body: PasswordComputeRequest;
    try {
      body = (await request.json()) as PasswordComputeRequest;
    } catch {
      return badRequest();
    }

    const operation = body.operation;
    if (
      operation !== "hash-password" &&
      operation !== "compare-password" &&
      operation !== "hash-pin" &&
      operation !== "compare-pin"
    )
      return badRequest();
    if (
      typeof body.secret !== "string" ||
      body.secret.length === 0 ||
      body.secret.length > PASSWORD_COMPUTE_MAX_SECRET_LENGTH
    )
      return badRequest();
    if (
      body.encodedHash !== undefined &&
      (typeof body.encodedHash !== "string" ||
        body.encodedHash.length === 0 ||
        body.encodedHash.length > 128)
    )
      return badRequest();
    if (body.routingKey !== undefined && typeof body.routingKey !== "string")
      return badRequest();

    try {
      const kind = operation.endsWith("pin") ? "pin" : "password";
      const stub = env.PASSWORD_COMPUTE.getByName(
        localPasswordComputeShardName(kind, body.routingKey),
      );
      if (operation === "hash-password") {
        return Response.json({ hash: await stub.hashPassword(body.secret) });
      }
      if (operation === "compare-password") {
        if (typeof body.encodedHash !== "string") return badRequest();
        return Response.json({
          ok: await stub.comparePassword(body.secret, body.encodedHash),
        });
      }
      if (operation === "hash-pin") {
        return Response.json({ hash: await stub.hashPin(body.secret) });
      }
      if (typeof body.encodedHash !== "string") return badRequest();
      return Response.json({
        ok: await stub.comparePin(body.secret, body.encodedHash),
      });
    } catch {
      // Keep credential/service implementation details out of the response.
      return new Response(null, { status: 503 });
    }
  },
};

export default passwordComputeWorker;
