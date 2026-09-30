// Provider registry (#264). Tests inject fakes instead of these.

import type { Provider } from "./config";
import type { HttpDeps } from "./http";
import { createGoogleAdapter, createGoogleOAuth } from "./google";
import { createMicrosoftAdapter, createMicrosoftOAuth } from "./microsoft";
import type { CalendarProviderAdapter, OAuthClient } from "./types";

export function adapterFor(
  provider: Provider,
  deps: HttpDeps = {},
): CalendarProviderAdapter {
  return provider === "google"
    ? createGoogleAdapter(deps)
    : createMicrosoftAdapter(deps);
}

export function oauthFor(provider: Provider, deps: HttpDeps = {}): OAuthClient {
  return provider === "google"
    ? createGoogleOAuth(deps)
    : createMicrosoftOAuth(deps);
}
