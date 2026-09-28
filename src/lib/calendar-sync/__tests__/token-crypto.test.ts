// At-rest encryption of calendar OAuth tokens (#264).

import { randomBytes } from "crypto";
import {
  decryptToken,
  encryptToken,
  isTokenKeyConfigured,
  needsReencrypt,
  TokenKeyMissingError,
  tokenAad,
} from "../token-crypto";
import { clearSyncEnv } from "./fakes";

const keyA = randomBytes(32).toString("base64");
const keyB = randomBytes(32).toString("base64");
const AAD = tokenAad.refresh("family-A");

afterEach(() => clearSyncEnv());

describe("calendar token encryption", () => {
  beforeEach(() => {
    process.env.CALENDAR_TOKEN_KEY = keyA;
  });

  it("round-trips with a versioned, non-plaintext ciphertext and a fresh IV", () => {
    const a = encryptToken("1//refresh-SECRET", AAD);
    const b = encryptToken("1//refresh-SECRET", AAD);
    expect(a.startsWith("ct1.")).toBe(true);
    expect(a.split(".")).toHaveLength(5);
    expect(a).not.toContain("SECRET");
    expect(a).not.toBe(b);
    expect(decryptToken(a, AAD)).toBe("1//refresh-SECRET");
  });

  it("rejects tampered, truncated, foreign-version and empty values", () => {
    const enc = encryptToken("secret", AAD);
    const parts = enc.split(".");
    const flipped = Buffer.from(parts[4], "base64url");
    flipped[0] ^= 1;
    expect(decryptToken([...parts.slice(0, 4), flipped.toString("base64url")].join("."), AAD)).toBeNull();
    expect(decryptToken(parts.slice(0, 4).join("."), AAD)).toBeNull();
    expect(decryptToken(enc.replace(/^ct1/, "ct9"), AAD)).toBeNull();
    expect(decryptToken("v1:abc:def:ghi", AAD)).toBeNull();
    expect(decryptToken(null, AAD)).toBeNull();
    expect(decryptToken("", AAD)).toBeNull();
  });

  it("binds a ciphertext to its purpose and household (AAD)", () => {
    const enc = encryptToken("secret", tokenAad.refresh("family-A"));
    expect(decryptToken(enc, tokenAad.refresh("family-B"))).toBeNull();
    expect(decryptToken(enc, tokenAad.access("family-A"))).toBeNull();
  });

  it("cannot be read with a different key, but a rotated-out key still decrypts via _PREVIOUS", () => {
    const enc = encryptToken("secret", AAD);
    process.env.CALENDAR_TOKEN_KEY = keyB;
    expect(decryptToken(enc, AAD)).toBeNull();
    expect(needsReencrypt(enc)).toBe(true);
    process.env.CALENDAR_TOKEN_KEY_PREVIOUS = keyA;
    expect(decryptToken(enc, AAD)).toBe("secret");
    expect(needsReencrypt(encryptToken("x", AAD))).toBe(false);
  });
});

describe("key configuration", () => {
  it("requires a base64 32-byte key", () => {
    expect(isTokenKeyConfigured()).toBe(false);
    expect(() => encryptToken("x", AAD)).toThrow(TokenKeyMissingError);
    process.env.CALENDAR_TOKEN_KEY = randomBytes(16).toString("base64");
    expect(isTokenKeyConfigured()).toBe(false);
    process.env.CALENDAR_TOKEN_KEY = "not a key";
    expect(isTokenKeyConfigured()).toBe(false);
    process.env.CALENDAR_TOKEN_KEY = keyA;
    expect(isTokenKeyConfigured()).toBe(true);
  });

  it("the error never contains key material", () => {
    process.env.CALENDAR_TOKEN_KEY = "short";
    try {
      encryptToken("x", AAD);
    } catch (err) {
      expect(String(err)).not.toContain("short");
    }
  });
});
