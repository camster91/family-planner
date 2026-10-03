// At-rest encryption for calendar OAuth tokens (#264).
//
// - AES-256-GCM (confidential + tamper-evident) with a dedicated 32-byte key
//   from CALENDAR_TOKEN_KEY (base64). Unlike secret-box.ts this key is NOT
//   derived from JWT_SECRET: rotating sessions must not destroy every calendar
//   connection, and a leaked JWT secret must not unlock provider tokens.
// - Versioned format: "ct1.<kid>.<iv>.<tag>.<ciphertext>" (base64url parts).
//   `kid` is a short fingerprint of the key, so a rotated key can still read
//   old rows via CALENDAR_TOKEN_KEY_PREVIOUS until they are re-encrypted.
// - Additional authenticated data binds a ciphertext to its purpose and
//   household ("refresh:<familyId>"), so a value copied into another row or
//   another family's row fails to decrypt.
// - Never log plaintext or ciphertext. Decrypt failures return null.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const VERSION = "ct1";

function parseKey(raw: string | undefined): Buffer | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  let key: Buffer;
  try {
    key = Buffer.from(value, "base64");
  } catch {
    return null;
  }
  return key.length === 32 ? key : null;
}

function keyId(key: Buffer): string {
  return createHash("sha256")
    .update("family-planner:calendar-token-key:")
    .update(key)
    .digest("hex")
    .slice(0, 8);
}

function currentKey(): Buffer | null {
  return parseKey(process.env.CALENDAR_TOKEN_KEY);
}

function keysById(): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const raw of [
    process.env.CALENDAR_TOKEN_KEY,
    process.env.CALENDAR_TOKEN_KEY_PREVIOUS,
  ]) {
    const key = parseKey(raw);
    if (key) out.set(keyId(key), key);
  }
  return out;
}

/** True when `raw` is a usable key: base64 of exactly 32 bytes. */
export function isValidTokenKey(raw: string | undefined): boolean {
  return parseKey(raw) !== null;
}

/** True when CALENDAR_TOKEN_KEY is set to a base64-encoded 32-byte key. */
export function isTokenKeyConfigured(): boolean {
  return currentKey() !== null;
}

export class TokenKeyMissingError extends Error {
  constructor() {
    super("Calendar token key is not configured");
    this.name = "TokenKeyMissingError";
  }
}

const b64u = (b: Buffer) => b.toString("base64url");

export function encryptToken(plain: string, aad: string): string {
  const key = currentKey();
  if (!key) throw new TokenKeyMissingError();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, keyId(key), b64u(iv), b64u(cipher.getAuthTag()), b64u(data)].join(".");
}

/** Null when missing, malformed, from an unknown key, tampered, or for another `aad`. */
export function decryptToken(
  stored: string | null | undefined,
  aad: string,
): string | null {
  if (!stored) return null;
  const parts = stored.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) return null;
  const key = keysById().get(parts[1]);
  if (!key) return null;
  try {
    const iv = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(parts[4], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** True when `stored` was written with a key other than the current one. */
export function needsReencrypt(stored: string | null | undefined): boolean {
  const key = currentKey();
  if (!stored || !key) return false;
  const parts = stored.split(".");
  return parts.length === 5 && parts[1] !== keyId(key);
}

export const tokenAad = {
  access: (familyId: string) => `access:${familyId}`,
  refresh: (familyId: string) => `refresh:${familyId}`,
  verifier: (familyId: string) => `pkce:${familyId}`,
};
