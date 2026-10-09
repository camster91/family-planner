/** Synthetic provider transport for guarded E2E servers only; never imported by the app. */
"use strict";
const SYNTHETIC_SCAN_KEY = "synthetic-e2e-inventory-only";
const SYNTHETIC_SCAN_ITEMS = [
  {
    name: "E2E inventory QA scan {name} 李",
    amount: 2,
    unit: "raw {unit} 李",
    location: "fridge",
    confidence: 0.95,
  },
  {
    name: "E2E inventory QA scan second",
    amount: null,
    unit: "bag",
    location: "pantry",
    confidence: 0.6,
  },
  {
    name: "E2E inventory QA scan uncertain",
    amount: null,
    unit: null,
    location: "freezer",
    confidence: 0.2,
  },
];
function createInventoryScanStub(realFetch) {
  return async function syntheticInventoryFetch(input, init) {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.href === "https://api.anthropic.com/v1/messages") {
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      if (method !== "POST" || headers.get("x-api-key") !== SYNTHETIC_SCAN_KEY)
        throw new Error(
          "Synthetic inventory scan refused a non-fixture request",
        );
      return Response.json(
        {
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({ items: SYNTHETIC_SCAN_ITEMS }),
            },
          ],
        },
        { headers: { "x-e2e-inventory-scan": "synthetic-fixed-endpoint" } },
      );
    }
    // Fail closed: this server cannot fall back to a real provider or follow an external redirect.
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error(
        "Synthetic inventory server refused external network access",
      );
    return realFetch(input, { ...init, redirect: "error" });
  };
}
module.exports = {
  createInventoryScanStub,
  SYNTHETIC_SCAN_KEY,
  SYNTHETIC_SCAN_ITEMS,
};
