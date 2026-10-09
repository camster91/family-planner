import type { PostHog } from "posthog-js";

/** Optional browser SDK; importing this helper does not load the SDK. */
export async function loadPostHog(): Promise<Pick<PostHog, "init">> {
  return (await import("posthog-js")).default;
}
