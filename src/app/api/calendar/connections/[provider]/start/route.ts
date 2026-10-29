import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import { createD1OAuthState } from "@/lib/cloudflare/calendar-oauth-state";
import {
  MAX_CALENDAR_CONNECTIONS,
  readD1CalendarConnections,
} from "@/lib/cloudflare/calendar-connections";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { getProviderConfig, isProvider } from "@/lib/calendar-sync/config";
import { createOAuthState } from "@/lib/calendar-sync/oauth";
import { oauthFor } from "@/lib/calendar-sync/providers";
import {
  authParentForSync,
  json,
  notFound,
} from "@/lib/calendar-sync/route-helpers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> };

// POST /api/calendar/connections/[provider]/start — parents only (#264).
// A POST (not a GET link) so the global CSRF check applies. Creates a
// single-use, 10-minute OAuth state bound to this member and household, with
// a PKCE challenge, and returns the provider's authorization URL for the
// browser to navigate to. 404 when the provider is not configured.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authParentForSync(request);
    if (error) return error;
    const { provider } = await context.params;
    if (!isProvider(provider)) return notFound();
    const config = getProviderConfig(provider);
    if (!config) return notFound();

    const limit = await checkRateLimit(
      `calsync-start:${auth.user.id}`,
      10,
      10 * 60 * 1000,
    );
    if (!limit.allowed) {
      return json(
        { error: "Too many connection attempts. Try again later." },
        429,
        { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      );
    }

    const backend = storageBackend();
    const nativeConnections =
      backend === "d1"
        ? await readD1CalendarConnections({
            userId: auth.user.id,
            familyId: auth.user.family_id,
            role: auth.user.role,
            generation: auth.payload.tv ?? 0,
          })
        : null;
    const existing =
      backend === "d1"
        ? nativeConnections?.find(
            (connection) =>
              connection.provider === provider && connection.is_mine,
          )
        : await prisma!.calendarConnection.findFirst({
            where: {
              family_id: auth.user.family_id,
              user_id: auth.user.id,
              provider,
            },
            select: { id: true },
          });
    if (!existing) {
      const count =
        backend === "d1"
          ? (nativeConnections?.length ?? 0)
          : await prisma!.calendarConnection.count({
              where: { family_id: auth.user.family_id },
            });
      if (count >= MAX_CALENDAR_CONNECTIONS) {
        return json(
          {
            error: `A household can connect at most ${MAX_CALENDAR_CONNECTIONS} calendars`,
          },
          409,
        );
      }
    }

    const nativeState =
      backend === "d1"
        ? await createD1OAuthState(
            {
              userId: auth.user.id,
              familyId: auth.user.family_id,
              generation: auth.payload.tv ?? 0,
            },
            provider,
          )
        : null;
    const { state, codeChallenge } =
      nativeState ??
      (await createOAuthState(prisma, {
        familyId: auth.user.family_id,
        userId: auth.user.id,
        provider,
      }));
    return json({
      authorize_url: oauthFor(provider).authorizeUrl(
        config,
        state,
        codeChallenge,
      ),
    });
  } catch {
    console.error("Error starting calendar connection");
    return json({ error: "Internal server error" }, 500);
  }
}
