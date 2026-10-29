import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import {
  readD1CalendarConnectionSecret,
  d1ConnectionDto,
} from "@/lib/cloudflare/calendar-connections";
import { syncD1CalendarConnectionExclusive } from "@/lib/cloudflare/calendar-two-way-sync";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { getProviderConfig, isProvider } from "@/lib/calendar-sync/config";
import {
  authParentForSync,
  json,
  notFound,
} from "@/lib/calendar-sync/route-helpers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/calendar/sync-connections/[id]/sync — "Sync now", any parent (#264).
// Rate-limited per connection. Returns counts and status, never event content.
// Re-running is safe: sync is idempotent.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authParentForSync(request);
    if (error) return error;
    const { id } = await context.params;
    const familyId = auth.user.family_id;
    const backend = storageBackend();

    const actor = {
      userId: auth.user.id,
      familyId,
      role: auth.user.role,
      generation: auth.payload.tv ?? 0,
    };
    const conn =
      backend === "d1"
        ? await readD1CalendarConnectionSecret(actor, id)
        : await prisma!.calendarConnection.findFirst({
            where: { id, family_id: familyId },
            select: { id: true, provider: true },
          });
    if (!conn) return json({ error: "Connected calendar not found" }, 404);
    if (!isProvider(conn.provider) || !getProviderConfig(conn.provider))
      return notFound();

    const limit = await checkRateLimit(
      `calsync-now:${conn.id}`,
      6,
      10 * 60 * 1000,
    );
    if (!limit.allowed) {
      return json(
        { error: "This calendar was synced a moment ago. Try again shortly." },
        429,
        { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      );
    }

    const result =
      backend === "d1"
        ? await syncD1CalendarConnectionExclusive(actor, conn.id)
        : await (
            await import("@/lib/calendar-sync/sync")
          ).syncConnectionExclusive(conn.id, familyId);
    if (!result) return json({ error: "Connected calendar not found" }, 404);

    const row =
      backend === "d1"
        ? await readD1CalendarConnectionSecret(actor, conn.id)
        : await prisma!.calendarConnection.findFirst({
            where: { id: conn.id, family_id: familyId },
            select: (await import("@/lib/calendar-sync/sync"))
              .CONNECTION_DTO_SELECT,
          });
    return json({
      result,
      connection: row
        ? backend === "d1"
          ? d1ConnectionDto(row as any, auth.user.id)
          : (await import("@/lib/calendar-sync/sync")).toConnectionDto(
              row,
              auth.user.id,
            )
        : null,
    });
  } catch {
    console.error("Error syncing calendar connection");
    return json({ error: "Internal server error" }, 500);
  }
}
