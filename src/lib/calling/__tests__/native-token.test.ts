import {
  nativeTokenAad,
  nativeTokenFingerprint,
  nativeTokenKeyReady,
  openNativeToken,
  sealNativeToken,
} from "../native-token";
const key = Buffer.alloc(32, 7).toString("base64"),
  nextKey = Buffer.alloc(32, 8).toString("base64");
const owner = {
  userId: "fabricated-user",
  familyId: "fabricated-family",
  generation: 0,
};
const stamp = { epoch: "fabricated-epoch", revision: 1 };
const aad = nativeTokenAad("fabricated-installation", owner, "android", stamp);
it("seals private routing material and rejects another owner, generation, or incarnation", () => {
  const encrypted = sealNativeToken(
    "fabricated-private-routing-token",
    aad,
    key,
  );
  expect(encrypted).not.toContain("fabricated-private-routing-token");
  expect(openNativeToken(encrypted, aad, key)).toBe(
    "fabricated-private-routing-token",
  );
  for (const other of [
    nativeTokenAad("other", owner, "android", stamp),
    nativeTokenAad(
      "fabricated-installation",
      { ...owner, generation: 1 },
      "android",
      stamp,
    ),
    nativeTokenAad("fabricated-installation", owner, "android", {
      ...stamp,
      revision: 2,
    }),
  ])
    expect(openNativeToken(encrypted, other, key)).toBeNull();
  expect(openNativeToken(encrypted.slice(0, -8), aad, key)).toBeNull();
});
it("supports explicit previous-key reads and stable destination dedupe across rotation", () => {
  const encrypted = sealNativeToken("fabricated-token", aad, key);
  expect(openNativeToken(encrypted, aad, nextKey)).toBeNull();
  expect(openNativeToken(encrypted, aad, nextKey, key)).toBe(
    "fabricated-token",
  );
  expect(nativeTokenFingerprint("fcm", "fabricated-token")).toHaveLength(64);
  expect(nativeTokenFingerprint("fcm", "fabricated-token")).not.toBe(
    nativeTokenFingerprint("apns-voip", "fabricated-token"),
  );
});
it("fails closed without a canonical dedicated 32-byte key", () => {
  for (const value of [
    undefined,
    "",
    "wrong",
    Buffer.alloc(16).toString("base64"),
    key + "junk",
  ]) {
    expect(nativeTokenKeyReady(value)).toBe(false);
    expect(() => sealNativeToken("fabricated-token", aad, value)).toThrow(
      "NATIVE_CALL_KEY_UNAVAILABLE",
    );
  }
});
