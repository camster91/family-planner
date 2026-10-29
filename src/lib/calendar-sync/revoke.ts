// Provider-grant cleanup shared by calendar disconnect and account deletion.
//
// Keep this small module independent from the calendar import/sync engine. The
// native D1 deletion path runs in a Worker fixture and only needs this
// post-commit best-effort effect; importing the full sync engine would also
// pull PostgreSQL and HTTP route helpers into that Worker bundle.
import { getProviderConfig, isProvider } from "./config";
import { oauthFor } from "./providers";
import { decryptToken, tokenAad } from "./token-crypto";

export type ProviderGrantForRevoke = {
  id: string;
  provider: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
};

export type ProviderRevokeDeps = {
  configFor?: typeof getProviderConfig;
  oauthFor?: typeof oauthFor;
};

/**
 * Revoke a connection's grant at the provider, best effort, with no database
 * writes. Returns true only when a configured provider accepted the revoke
 * request. The caller decides when this is safe to run relative to its local
 * transaction.
 */
export async function revokeProviderGrant(
  conn: ProviderGrantForRevoke,
  familyId: string,
  deps: ProviderRevokeDeps = {},
): Promise<boolean> {
  if (!isProvider(conn.provider)) return false;
  const config = (deps.configFor ?? getProviderConfig)(conn.provider);
  const token =
    decryptToken(conn.refresh_token_enc, tokenAad.refresh(familyId)) ??
    decryptToken(conn.access_token_enc, tokenAad.access(familyId));
  if (!config || !token) return false;
  try {
    await (deps.oauthFor ?? oauthFor)(conn.provider).revoke(config, token);
    return true;
  } catch {
    // Provider cleanup is intentionally best effort. Local deletion has
    // already committed before this function is called by native deletion.
    console.warn("[calendar-sync] revoke failed", {
      connectionId: conn.id,
    });
    return false;
  }
}
