// jsdom does not provide all browser APIs used by the owned draft journals.
// Use Node's real crypto/encoding implementations; never replace randomness
// with a constant or change the production implementations for test support.
if (typeof document !== "undefined") {
  require("@testing-library/jest-dom");
  const { webcrypto, randomUUID } = require("node:crypto");
  const { TextEncoder, TextDecoder } = require("node:util");
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  if (!globalThis.crypto.randomUUID) {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: randomUUID,
    });
  }
  if (!globalThis.TextEncoder) globalThis.TextEncoder = TextEncoder;
  if (!globalThis.TextDecoder) globalThis.TextDecoder = TextDecoder;
}
