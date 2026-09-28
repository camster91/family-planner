import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enabledProviders, PROVIDER_LABELS } from "@/lib/calendar-sync/config";
import { authParentForSync, json } from "@/lib/calendar-sync/route-helpers";
import {
  CONNECTION_DTO_SELECT,
  MAX_CONNECTIONS_PER_FAMILY,
  toConnectionDto,
} from "@/lib/calendar-sync/sync";

export const dynamic = "force-dynamic";

// GET /api/calendar/connections — parents only (#264).
// 404 while calendar sync is not configured (kill switch). Lists the
// providers available to connect and this household's connections. Never
// returns tokens, sync cursors or event content.
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authParentForSync(request);
    if (error) return error;

    const rows = await prisma!.calendarConnection.findMany({
      where: { family_id: auth.user.family_id },
      select: CONNECTION_DTO_SELECT,
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      take: MAX_CONNECTIONS_PER_FAMILY,
    });
    return json({
      providers: enabledProviders().map((id) => ({
        id,
        label: PROVIDER_LABELS[id],
      })),
      connections: rows.map((r) => toConnectionDto(r, auth.user.id)),
    });
  } catch {
    console.error("Error listing calendar connections");
    return json({ error: "Internal server error" }, 500);
  }
}
