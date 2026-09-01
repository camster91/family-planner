import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) return error;
  const parentError = requireParent(auth.user.role);
  if (parentError) return parentError;

  const params = new URL(request.url).searchParams;
  const requestedLimit = Number.parseInt(params.get("limit") || "50", 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 50;
  const cursor = params.get("cursor");
  const cursorDate = cursor ? new Date(cursor) : null;
  if (cursorDate && Number.isNaN(cursorDate.getTime())) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  const logs = await prisma!.auditLog.findMany({
    where: {
      family_id: auth.user.family_id,
      ...(cursorDate ? { created_at: { lt: cursorDate } } : {}),
    },
    orderBy: { created_at: "desc" },
    take: limit,
  });
  const actorIds = [
    ...new Set(logs.flatMap((log) => (log.actor_id ? [log.actor_id] : []))),
  ];
  const actors = await prisma!.user.findMany({
    where: { family_id: auth.user.family_id, id: { in: actorIds } },
    select: { id: true, name: true },
  });
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));

  return NextResponse.json({
    logs: logs.map((log) => ({
      ...log,
      actor_name: log.actor_id
        ? actorNames.get(log.actor_id) || "Deleted member"
        : "System",
    })),
    nextCursor:
      logs.length === limit ? logs.at(-1)?.created_at.toISOString() : null,
  });
}
