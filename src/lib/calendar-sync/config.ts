// Kill switch and configuration for two-way calendar sync (#264).
//
// Everything is dormant unless the operator configures it: a provider is
// available only when its OAuth client credentials AND a valid
// CALENDAR_TOKEN_KEY AND a public app URL are all present. With nothing set,
// every connection route answers 404 and the settings UI hides the section.
// See docs/runbooks/CALENDAR_SYNC.md.

import { isTokenKeyConfigured } from "./token-crypto";

export const PROVIDERS = ["google", "microsoft"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = {
  google: "Google Calendar",
  microsoft: "Outlook / Microsoft 365",
};

export interface ProviderConfig {
  provider: Provider;
  clientId: string;
  clientSecret: string;
  /** Microsoft only: tenant id, or "common" / "consumers" / "organizations". */
  tenant?: string;
  redirectUri: string;
}

export function isProvider(value: unknown): value is Provider {
  return (
    typeof value === "string" &&
    (PROVIDERS as readonly string[]).includes(value)
  );
}

const env = (name: string): string => (process.env[name] ?? "").trim();

/**
 * Public origin used to build OAuth redirect URIs. Read from APP_URL (or the
 * existing NEXT_PUBLIC_APP_URL) only, never from request headers, so a forged
 * Host header cannot redirect an authorization code elsewhere. Must be https,
 * except http://localhost for local development.
 */
export function appOrigin(): string | null {
  const raw = env("APP_URL") || env("NEXT_PUBLIC_APP_URL");
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    return null;
  if (url.username || url.password) return null;
  return url.origin;
}

export function redirectUriFor(provider: Provider): string | null {
  const origin = appOrigin();
  return origin
    ? `${origin}/api/calendar/connections/${provider}/callback`
    : null;
}

const TENANT_RE = /^[A-Za-z0-9.-]{1,64}$/;

export function getProviderConfig(provider: Provider): ProviderConfig | null {
  if (!isTokenKeyConfigured()) return null;
  const redirectUri = redirectUriFor(provider);
  if (!redirectUri) return null;
  if (provider === "google") {
    const clientId = env("GOOGLE_CLIENT_ID");
    const clientSecret = env("GOOGLE_CLIENT_SECRET");
    if (!clientId || !clientSecret) return null;
    return { provider, clientId, clientSecret, redirectUri };
  }
  const clientId = env("MICROSOFT_CLIENT_ID");
  const clientSecret = env("MICROSOFT_CLIENT_SECRET");
  const tenant = env("MICROSOFT_TENANT");
  if (!clientId || !clientSecret || !tenant || !TENANT_RE.test(tenant))
    return null;
  return { provider, clientId, clientSecret, tenant, redirectUri };
}

export function enabledProviders(): Provider[] {
  return PROVIDERS.filter((p) => getProviderConfig(p) !== null);
}

export function isCalendarSyncEnabled(): boolean {
  return enabledProviders().length > 0;
}
