/** No external transport is available in the isolated Settings QA server. */
"use strict";
function createSettingsQaFetch(realFetch, port) {
  return async function settingsQaFetch(input, init) {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.port !== String(port) ||
      url.username ||
      url.password
    )
      throw new Error("Settings QA server refused non-fixture network access");
    // Even a fixture endpoint must not redirect to an external provider.
    return realFetch(input, { ...init, redirect: "error" });
  };
}
module.exports = { createSettingsQaFetch };
