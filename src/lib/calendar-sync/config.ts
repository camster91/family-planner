// Kill switch and configuration for two-way calendar sync (#264).
//
// Everything is dormant unless the operator configures it: a provider is
// available only when its OAuth client credentials AND a valid
// CALENDAR_TOKEN_KEY AND a public app URL are all present. With nothing set,
// every connection route answers 404 and the settings UI hides the section.
// See docs/runbooks/CALENDAR_SYNC.md.

import { isTokenKeyConfigured, isValidTokenKey } from "./token-crypto";

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

type Env = Record<string, string | undefined>;

const env = (name: string): string => (process.env[name] ?? "").trim();

/**
 * Public origin used to build OAuth redirect URIs. Read from APP_URL (or the
 * existing NEXT_PUBLIC_APP_URL) only, never from request headers, so a forged
 * Host header cannot redirect an authorization code elsewhere. Must be https,
 * except http://localhost for local development.
 */
export function appOrigin(): string | null {
  return appOriginFrom(process.env);
}

function appOriginFrom(source: Env): string | null {
  const raw =
    (source.APP_URL ?? "").trim() || (source.NEXT_PUBLIC_APP_URL ?? "").trim();
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
  // Unset means "common": personal and work or school accounts (owner
  // decision 2026-10-03). Set it only to narrow sign-in to one tenant.
  const tenant = env("MICROSOFT_TENANT") || "common";
  if (!clientId || !clientSecret || !TENANT_RE.test(tenant)) return null;
  return { provider, clientId, clientSecret, tenant, redirectUri };
}

/**
 * Why calendar sync is not (fully) on, for the start-up log. Empty when
 * nothing calendar-related is set (dormant on purpose) or when every provider
 * that has any setting is complete. Variable names and fixed reasons only,
 * never values.
 */
export function calendarSyncConfigProblems(source: Env): string[] {
  const has = (name: string) => (source[name] ?? "").trim() !== "";
  const google = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
  const microsoft = ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"];
  const touched = [
    "CALENDAR_TOKEN_KEY",
    ...google,
    ...microsoft,
  ].some(has);
  if (!touched) return [];

  const problems: string[] = [];
  if (!has("CALENDAR_TOKEN_KEY")) {
    problems.push("CALENDAR_TOKEN_KEY is not set.");
  } else if (!isValidTokenKey(source.CALENDAR_TOKEN_KEY)) {
    problems.push(
      "CALENDAR_TOKEN_KEY is not base64 of exactly 32 bytes. Make one with: openssl rand -base64 32",
    );
  }
  if (
    has("CALENDAR_TOKEN_KEY_PREVIOUS") &&
    !isValidTokenKey(source.CALENDAR_TOKEN_KEY_PREVIOUS)
  ) {
    problems.push(
      "CALENDAR_TOKEN_KEY_PREVIOUS is not base64 of exactly 32 bytes, so it is ignored.",
    );
  }
  if (!appOriginFrom(source)) {
    problems.push(
      "APP_URL (or NEXT_PUBLIC_APP_URL) is not set to an https address at runtime, so no redirect URI can be built.",
    );
  }
  for (const [label, names] of [
    ["Google", google],
    ["Outlook", microsoft],
  ] as const) {
    const set = names.filter(has);
    if (set.length > 0 && set.length < names.length) {
      const missing = names.filter((n) => !has(n)).join(", ");
      problems.push(`${label} is off: ${missing} is not set.`);
    }
  }
  if (microsoft.every(has)) {
    const tenant = (source.MICROSOFT_TENANT ?? "").trim();
    if (tenant && !TENANT_RE.test(tenant)) {
      problems.push("Outlook is off: MICROSOFT_TENANT is not a valid tenant id or name.");
    }
  }
  if (!google.every(has) && !microsoft.every(has)) {
    problems.push(
      "No provider has both a client id and a client secret, so calendar sync stays off.",
    );
  }
  return problems;
}

export function enabledProviders(): Provider[] {
  return PROVIDERS.filter((p) => getProviderConfig(p) !== null);
}

export function isCalendarSyncEnabled(): boolean {
  return enabledProviders().length > 0;
}
