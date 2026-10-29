import bcrypt from "bcryptjs";
import { DurableObject } from "cloudflare:workers";
import {
  LOCAL_PASSWORD_COMPUTE_ROUNDS,
  PASSWORD_COMPUTE_MAX_SECRET_LENGTH,
  PasswordComputeInputError,
} from "./local-password-compute";

const MAX_ENCODED_HASH_LENGTH = 128;

function requireSecret(secret: string): string {
  if (
    typeof secret !== "string" ||
    secret.length === 0 ||
    secret.length > PASSWORD_COMPUTE_MAX_SECRET_LENGTH
  )
    throw new PasswordComputeInputError();
  return secret;
}

function requireEncodedHash(encodedHash: string): string {
  if (
    typeof encodedHash !== "string" ||
    encodedHash.length === 0 ||
    encodedHash.length > MAX_ENCODED_HASH_LENGTH
  )
    throw new PasswordComputeInputError();
  return encodedHash;
}

/**
 * Compute-only RPC object. It deliberately has no fetch handler and never
 * touches Durable Object storage. Passwords, hashes, PINs and metadata are
 * neither persisted nor logged; only the bcrypt result crosses the RPC.
 */
export class LocalPasswordCompute extends DurableObject {
  async hashPassword(secret: string): Promise<string> {
    return bcrypt.hash(requireSecret(secret), LOCAL_PASSWORD_COMPUTE_ROUNDS);
  }

  async comparePassword(secret: string, encodedHash: string): Promise<boolean> {
    return bcrypt.compare(
      requireSecret(secret),
      requireEncodedHash(encodedHash),
    );
  }

  async hashPin(pin: string): Promise<string> {
    return this.hashPassword(pin);
  }

  async comparePin(pin: string, encodedHash: string): Promise<boolean> {
    return this.comparePassword(pin, encodedHash);
  }
}
