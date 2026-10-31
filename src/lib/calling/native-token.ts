import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { NativeCallOwner } from "./native-registration-contract";

// Dedicated key, independent of session signing and calendar OAuth secrets.
// Token fingerprints remain stable across encryption-key rotation.
const parse = (raw?: string): Buffer | null => {
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 && key.toString("base64") === raw ? key : null;
};
const kid = (key: Buffer) =>
  createHash("sha256")
    .update("herewoven:native-call-key:")
    .update(key)
    .digest("hex")
    .slice(0, 16);
export const nativeTokenKeyReady = (raw?: string) => parse(raw) !== null;
export const nativeTokenAad = (
  id: string,
  owner: NativeCallOwner,
  platform: string,
  stamp: { epoch: string; revision: number },
) =>
  JSON.stringify([
    "herewoven.native-call-token.v1",
    id,
    owner.userId,
    owner.familyId,
    owner.generation,
    platform,
    stamp.epoch,
    stamp.revision,
  ]);
export const nativeTokenFingerprint = (provider: string, token: string) =>
  createHash("sha256")
    .update(
      JSON.stringify(["herewoven.native-call-destination.v1", provider, token]),
    )
    .digest("hex");
export function sealNativeToken(token: string, aad: string, rawKey?: string) {
  const key = parse(rawKey);
  if (!key) throw Error("NATIVE_CALL_KEY_UNAVAILABLE");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    "nc1",
    kid(key),
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function openNativeToken(
  stored: string | null | undefined,
  aad: string,
  rawKey?: string,
  previousKey?: string,
): string | null {
  if (typeof stored !== "string" || stored.length > 7000) return null;
  const [version, id, ivText, tagText, data, extra] = stored.split(".");
  if (version !== "nc1" || extra !== undefined || !data || !ivText || !tagText)
    return null;
  const key = [parse(rawKey), parse(previousKey)].find(
    (k) => k && kid(k) === id,
  );
  if (!key) return null;
  try {
    const iv = Buffer.from(ivText, "base64url"),
      tag = Buffer.from(tagText, "base64url");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
