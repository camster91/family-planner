import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import {
  appOrigin,
  getProviderConfig,
  isCalendarSyncEnabled,
  isProvider,
} from "@/lib/calendar-sync/config";
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

    let tokens;
    try {
      tokens = await oauthFor(provider).exchangeCode(
        config,
        code,
        consumed.codeVerifier,
      );
    } catch {
      console.warn("[calendar-sync] code exchange failed", { provider });
      return back("exchange");
    }

    const familyId = auth.user.family_id;
    const data: Record<string, unknown> = {
      access_token_enc: encryptToken(
        tokens.accessToken,
        tokenAad.access(familyId),
      ),
      token_expires_at: tokens.expiresAt,
      // Re-connecting restarts incremental sync from a full listing; links
      // keep it idempotent.
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

    const where = {
      family_id: familyId,
      user_id: auth.user.id,
      provider,
    };
    const existing = await prisma!.calendarConnection.findFirst({
      where,
      select: { id: true, refresh_token_enc: true },
    });
    if (!tokens.refreshToken && !existing?.refresh_token_enc) {
      // Without a refresh token the connection would die within the hour.
      return back("exchange");
    }
    if (existing) {
      await prisma!.calendarConnection.updateMany({
        where: { id: existing.id, family_id: familyId },
        data,
      });
    } else {
      try {
        await prisma!.calendarConnection.create({
          data: { ...where, ...data } as any,
        });
      } catch (err) {
        if ((err as { code?: string } | null)?.code !== "P2002") throw err;
        await prisma!.calendarConnection.updateMany({ where, data });
      }
    }
    return back("connected");
  } catch {
    console.error("Error completing calendar connection");
    return back("error");
  }
}
