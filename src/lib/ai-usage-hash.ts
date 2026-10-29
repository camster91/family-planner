import { createHmac } from "node:crypto";
import { getJwtSecret } from "./auth";
import type { CaptureConfig } from "./capture";

/** Provider pricing identity; never persisted with the provider secret. */
export function aiConfigHash(config: CaptureConfig): string {
  return createHmac("sha256", getJwtSecret())
    .update(
      JSON.stringify([
        "herewoven.ai-pricing.v1",
        config.baseUrl,
        config.model,
        config.apiKey,
      ]),
    )
    .digest("hex");
}
