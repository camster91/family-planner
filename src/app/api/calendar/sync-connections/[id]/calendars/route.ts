import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authParentForSync, json } from "@/lib/calendar-sync/route-helpers";
import {
  ConnectionNotReadyError,
  listConnectionCalendars,
} from "@/lib/calendar-sync/sync";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/calendar/sync-connections/[id]/calendars — the connecting member only (#264).
// Lists the member's writable provider calendars (id, name, primary) so they
// can pick one. The names are that member's personal data, so other parents
// in the household get 403. Foreign ids are 404.
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authParentForSync(request);
    if (error) return error;
    const { id } = await context.params;

    const conn = await prisma!.calendarConnection.findFirst({
      where: { id, family_id: auth.user.family_id },
      select: { id: true, user_id: true },
    });
    if (!conn) return json({ error: "Connected calendar not found" }, 404);
    if (conn.user_id !== auth.user.id) {
      return json(
        { error: "Only the member who connected this calendar can see its calendars" },
        403,
      );
    }

    let calendars;
    try {
      calendars = await listConnectionCalendars(conn.id, auth.user.family_id);
    } catch (err) {
      if (err instanceof ConnectionNotReadyError) {
        return json(
          {
            error:
              err.reason === "reauth"
                ? "Reconnect this calendar first"
                : "This calendar provider is not available",
          },
          err.reason === "reauth" ? 409 : 404,
        );
      }
      return json({ error: "Could not load calendars from the provider" }, 502);
    }
    return json({
      calendars: (calendars ?? [])
        .filter((c) => c.canWrite)
        .map((c) => ({ id: c.id, name: c.name, primary: c.primary })),
    });
  } catch {
    console.error("Error listing provider calendars");
    return json({ error: "Internal server error" }, 500);
  }
}
