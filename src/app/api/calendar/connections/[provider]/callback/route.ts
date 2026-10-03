import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import {
  appOrigin,
  getProviderConfig,
  isCalendarSyncEnabled,
  isProvider,
} from "@/lib/calendar-sync/config";
import {
  commitConnection,
  type CommitOutcome,
} from "@/lib/calendar-sync/connections";
import { revokeProviderGrant } from "@/lib/calendar-sync/sync";
import { consumeOAuthState } from "@/lib/calendar-sync/oauth";
import { oauthFor } from "@/lib/calendar-sync/providers";
import { notFound } from "@/lib/calendar-sync/route-helpers";
import { encryptToken, tokenAad } from "@/lib/calendar-sync/token-crypto";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> };

type Outcome =
  | "connected"
  | "denied"
  | "state"
  | "exchange"
  | "forbidden"
  | "limit"
  | "scope"
  | "error";

function back(outcome: Outcome): NextResponse {
  // Redirect target comes from configuration, never from the request.
  const url = new URL("/dashboard/settings", appOrigin() ?? "http://localhost");
  url.searchParams.set("calendar_sync", outcome);
  url.hash = "calendar-sync";
  const res = NextResponse.redirect(url, 303);
  // The callback URL carried an authorization code: keep it out of Referer and caches.
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

// GET /api/calendar/connections/[provider]/callback — OAuth redirect target (#264).
//
// A GET because the provider redirects the browser here; the global CSRF
// header check does not apply to GET, and the single-use `state` (bound to
// the signed-in member, household and provider, 10-minute expiry) is the
// CSRF defence. Requires the same person session that started the flow
// (the Lax session cookie is sent on this top-level navigation); a device
// cookie is not a session and gets 401. Never logs the code, state or tokens.
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    if (!isCalendarSyncEnabled()) return notFound();
    const { provider } = await context.params;
    if (!isProvider(provider)) return notFound();
    const config = getProviderConfig(provider);
    if (!config) return notFound();

    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    if (auth.user.role !== "parent") return back("forbidden");

    const params = new URL(request.url).searchParams;
    const state = params.get("state") ?? "";
    const code = params.get("code") ?? "";
    const providerError = params.get("error");

    const consumed = await consumeOAuthState(prisma, {
      state,
      familyId: auth.user.family_id,
      userId: auth.user.id,
      provider,
    });
    if (!consumed.ok) return back("state");
    if (providerError || !code || code.length > 4096) return back("denied");

    const oauth = oauthFor(provider);
    let tokens;
    try {
      tokens = await oauth.exchangeCode(
        config,
        code,
        consumed.codeVerifier,
      );
    } catch {
      console.warn("[calendar-sync] code exchange failed", { provider });
      return back("exchange");
    }

    const familyId = auth.user.family_id;
    if (!oauth.hasRequiredScopes(tokens.scope)) {
      // The member unticked a calendar permission on Google's consent screen.
      // Sync could not work, so store nothing and give the grant back.
      await revokeProviderGrant(
        {
          id: "unsaved",
          provider,
          access_token_enc: encryptToken(tokens.accessToken, tokenAad.access(familyId)),
          refresh_token_enc: tokens.refreshToken
            ? encryptToken(tokens.refreshToken, tokenAad.refresh(familyId))
            : null,
        },
        familyId,
      );
      return back("scope");
    }
    const data: Record<string, unknown> = {
      access_token_enc: encryptToken(
        tokens.accessToken,
        tokenAad.access(familyId),
      ),
      token_expires_at: tokens.expiresAt,
      // Re-connecting restarts incremental sync from a full listing; links
      // keep it idempotent (the commit also bumps the generation).
      sync_cursor: null,
      status: "pending",
      last_error: null,
    };
    if (tokens.refreshToken) {
      data.refresh_token_enc = encryptToken(
        tokens.refreshToken,
        tokenAad.refresh(familyId),
      );
    }

    // Household limit + one-per-member-per-provider, enforced atomically here
    // (the start route's check is only an early refusal). The commit also
    // refuses ("gone") when the household or member was deleted meanwhile.
    let outcome: CommitOutcome | "failed";
    try {
      outcome = await commitConnection(prisma, {
        familyId,
        userId: auth.user.id,
        provider,
        data,
        hasRefreshToken: Boolean(tokens.refreshToken),
      });
    } catch {
      outcome = "failed";
    }
    if (outcome === "created" || outcome === "updated") return back("connected");

    // Not stored, for any reason: the provider already issued this grant and
    // nothing local will ever revoke it, so revoke it now (best effort, no
    // database writes).
    await revokeProviderGrant(
      {
        id: "unsaved",
        provider,
        access_token_enc: data.access_token_enc as string,
        refresh_token_enc: (data.refresh_token_enc as string | undefined) ?? null,
      },
      familyId,
    );
    if (outcome === "no_refresh_token") return back("exchange");
    if (outcome === "limit") return back("limit");
    if (outcome === "gone") return back("forbidden");
    return back("error");
  } catch {
    console.error("Error completing calendar connection");
    return back("error");
  }
}
