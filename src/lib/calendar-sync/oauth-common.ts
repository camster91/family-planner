// Token endpoint helpers shared by the Google and Microsoft OAuth clients (#264).

import {
  ensureOk,
  providerFetch,
  ProviderHttpError,
  readJson,
  type HttpDeps,
} from "./http";
import { OAuthGrantError, type TokenSet } from "./types";

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
}

/**
 * POST a form to a token endpoint and return the token set. A 400/401 with
 * `invalid_grant` on a refresh means the grant is gone (OAuthGrantError).
 * Error bodies are never logged or surfaced: they can echo codes.
 */
export async function postTokenForm(
  url: string,
  form: Record<string, string>,
  deps: HttpDeps,
  opts: { refresh: boolean; now?: () => number },
): Promise<TokenSet> {
  const res = await providerFetch(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(form).toString(),
    },
    deps,
  );
  if (res.status === 400 || res.status === 401) {
    let body: TokenResponse = {};
    try {
      body = await readJson<TokenResponse>(res);
    } catch {
      // ignore
    }
    if (opts.refresh && body.error === "invalid_grant")
      throw new OAuthGrantError();
    throw new ProviderHttpError("http", res.status);
  }
  await ensureOk(res);
  const body = await readJson<TokenResponse>(res);
  if (typeof body.access_token !== "string" || !body.access_token)
    throw new ProviderHttpError("bad_response", res.status);
  const expiresIn =
    typeof body.expires_in === "number"
      ? body.expires_in
      : Number(body.expires_in) || 3600;
  const now = (opts.now ?? Date.now)();
  return {
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === "string" && body.refresh_token
        ? body.refresh_token
        : null,
    expiresAt: new Date(now + Math.max(60, expiresIn) * 1000),
    scope: typeof body.scope === "string" ? body.scope.slice(0, 500) : null,
  };
}
