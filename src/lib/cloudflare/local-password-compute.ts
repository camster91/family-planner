/**
 * Private password computation boundary.
 *
 * The compute class deliberately has no fetch handler and never touches
 * Durable Object storage. The application owns auth, rate limits, sessions,
 * and receipts; this Worker only performs bcrypt12 and returns a hash/boolean.
 */
export const LOCAL_PASSWORD_COMPUTE_ROUNDS = 12 as const;
export const LOCAL_PASSWORD_COMPUTE_SHARD_COUNT = 4 as const;
export const LOCAL_PASSWORD_COMPUTE_NAME_PREFIX = "local-password-compute";
export const PASSWORD_COMPUTE_MAX_SECRET_LENGTH = 128 as const;

export class PasswordComputeUnavailableError extends Error {
  constructor() {
    super("Password compute binding is unavailable");
    this.name = "PasswordComputeUnavailableError";
  }
}

export class PasswordComputeInputError extends Error {
  constructor() {
    super("Password compute input is invalid");
    this.name = "PasswordComputeInputError";
  }
}

export type LocalPasswordComputeBinding = Pick<
  {
    getByName(name: string): LocalPasswordComputeStub;
  },
  "getByName"
>;

export type LocalPasswordComputeStub = {
  hashPassword(secret: string): Promise<string>;
  comparePassword(secret: string, encodedHash: string): Promise<boolean>;
  hashPin(pin: string): Promise<string>;
  comparePin(pin: string, encodedHash: string): Promise<boolean>;
};

export type LocalPasswordComputeAdapter = {
  hashPassword(secret: string, routingKey?: string): Promise<string>;
  comparePassword(
    secret: string,
    encodedHash: string,
    routingKey?: string,
  ): Promise<boolean>;
  /** Auth-compatible aliases; neither changes authority or persistence. */
  verifyPassword(
    secret: string,
    encodedHash: string,
    routingKey?: string,
  ): Promise<boolean>;
  hashPin(pin: string, routingKey?: string): Promise<string>;
  comparePin(
    pin: string,
    encodedHash: string,
    routingKey?: string,
  ): Promise<boolean>;
  verifyPin(
    pin: string,
    encodedHash: string,
    routingKey?: string,
  ): Promise<boolean>;
};

/**
 * A Worker-to-Worker service binding used by the application Worker.  The
 * Durable Object namespace stays private to the compute Worker; the app only
 * sees this narrow fetch surface and never exposes a password endpoint on its
 * public origin.
 */
export type PasswordComputeServiceBinding = {
  fetch(request: Request): Promise<Response>;
};

export const PASSWORD_COMPUTE_SERVICE_PATH = "/v1/compute";

type PasswordComputeServicePayload = {
  operation: "hash-password" | "compare-password" | "hash-pin" | "compare-pin";
  secret: string;
  encodedHash?: string;
  routingKey?: string;
};

function requireServiceBinding(
  binding: PasswordComputeServiceBinding | null | undefined,
): PasswordComputeServiceBinding {
  if (!binding || typeof binding.fetch !== "function")
    throw new PasswordComputeUnavailableError();
  return binding;
}

async function serviceCall(
  binding: PasswordComputeServiceBinding,
  payload: PasswordComputeServicePayload,
): Promise<string | boolean> {
  const response = await binding.fetch(
    new Request(
      `https://password-compute.internal${PASSWORD_COMPUTE_SERVICE_PATH}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),
  );
  if (!response.ok) {
    // Do not surface provider/service response text: it could accidentally
    // contain request material or implementation details.
    throw new PasswordComputeUnavailableError();
  }
  const body = (await response.json()) as { hash?: unknown; ok?: unknown };
  if (payload.operation.startsWith("hash-")) {
    if (typeof body.hash !== "string")
      throw new PasswordComputeUnavailableError();
    return body.hash;
  }
  if (typeof body.ok !== "boolean") throw new PasswordComputeUnavailableError();
  return body.ok;
}

/**
 * Service-binding adapter for the production application Worker. Missing or
 * unhealthy bindings fail closed; callers never silently perform bcrypt in a
 * Free-plan HTTP invocation.
 */
export function createPasswordComputeServiceAdapter(
  binding: PasswordComputeServiceBinding | null | undefined,
): LocalPasswordComputeAdapter {
  const service = requireServiceBinding(binding);
  return {
    hashPassword: async (secret, routingKey) =>
      (await serviceCall(service, {
        operation: "hash-password",
        secret,
        routingKey,
      })) as string,
    comparePassword: async (secret, encodedHash, routingKey) =>
      (await serviceCall(service, {
        operation: "compare-password",
        secret,
        encodedHash,
        routingKey,
      })) as boolean,
    verifyPassword: async (secret, encodedHash, routingKey) =>
      (await serviceCall(service, {
        operation: "compare-password",
        secret,
        encodedHash,
        routingKey,
      })) as boolean,
    hashPin: async (pin, routingKey) =>
      (await serviceCall(service, {
        operation: "hash-pin",
        secret: pin,
        routingKey,
      })) as string,
    comparePin: async (pin, encodedHash, routingKey) =>
      (await serviceCall(service, {
        operation: "compare-pin",
        secret: pin,
        encodedHash,
        routingKey,
      })) as boolean,
    verifyPin: async (pin, encodedHash, routingKey) =>
      (await serviceCall(service, {
        operation: "compare-pin",
        secret: pin,
        encodedHash,
        routingKey,
      })) as boolean,
  };
}

function stableShard(input: string): number {
  // A small deterministic hash is sufficient for routing. The routing key is
  // never included in the object name, persisted, or logged.
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0) % LOCAL_PASSWORD_COMPUTE_SHARD_COUNT;
}

export function localPasswordComputeShardName(
  operation: "password" | "pin",
  routingKey = "default",
): string {
  if (typeof routingKey !== "string" || routingKey.length > 128)
    throw new PasswordComputeInputError();
  return `${LOCAL_PASSWORD_COMPUTE_NAME_PREFIX}-${stableShard(`${operation}\u0000${routingKey}`)}`;
}

function requireBinding(
  binding: LocalPasswordComputeBinding | null | undefined,
): LocalPasswordComputeBinding {
  if (!binding || typeof binding.getByName !== "function")
    throw new PasswordComputeUnavailableError();
  return binding;
}

/**
 * Explicit adapter: missing binding is a hard, inspectable failure. There is
 * no silent in-request bcrypt fallback that could put Free-plan HTTP back on
 * the 10 ms CPU path.
 */
export function createLocalPasswordComputeAdapter(
  binding: LocalPasswordComputeBinding | null | undefined,
): LocalPasswordComputeAdapter {
  const namespace = requireBinding(binding);
  const stub = (operation: "password" | "pin", routingKey?: string) =>
    namespace.getByName(localPasswordComputeShardName(operation, routingKey));
  return {
    hashPassword: (secret, routingKey) =>
      stub("password", routingKey).hashPassword(secret),
    comparePassword: (secret, encodedHash, routingKey) =>
      stub("password", routingKey).comparePassword(secret, encodedHash),
    verifyPassword: (secret, encodedHash, routingKey) =>
      stub("password", routingKey).comparePassword(secret, encodedHash),
    hashPin: (pin, routingKey) => stub("pin", routingKey).hashPin(pin),
    comparePin: (pin, encodedHash, routingKey) =>
      stub("pin", routingKey).comparePin(pin, encodedHash),
    verifyPin: (pin, encodedHash, routingKey) =>
      stub("pin", routingKey).comparePin(pin, encodedHash),
  };
}
