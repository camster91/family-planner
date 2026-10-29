import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { timelineQuery } from "@/lib/review-inbox/timeline-contract";
import {
  readChangeTimeline,
  decodeTimelineCursor,
  TimelineAccessError,
} from "@/lib/review-inbox/timeline";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { storageBackend } from "@/lib/storage-backend";
import { readD1ChangeTimeline } from "@/lib/cloudflare/review-inbox";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    const refusal = requireParent(auth.user.role);
    if (refusal) {
      refusal.headers.set("Cache-Control", "private, no-store");
      return refusal;
    }
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some((key) => !["source", "cursor"].includes(key)) ||
      params.getAll("source").length > 1 ||
      params.getAll("cursor").length > 1
    )
      return reply({ error: "Invalid timeline query" }, 400);
    const query = timelineQuery.safeParse({
      source: params.get("source") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
    });
    if (!query.success) return reply({ error: "Invalid timeline query" }, 400);
    try {
      decodeTimelineCursor(query.data.cursor, query.data.source);
    } catch {
      return reply({ error: "Invalid timeline cursor" }, 400);
    }
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
    };
    return reply(
      storageBackend() === "d1"
        ? await readD1ChangeTimeline(actor, query.data)
        : await readChangeTimeline(prisma!, actor, query.data),
    );
  } catch (error) {
    if (error instanceof TimelineAccessError)
      return reply({ error: "Timeline unavailable" }, error.status);
    logRouteError("GET review timeline", error, getRequestId(request));
    return reply({ error: "Timeline unavailable" }, 500);
  }
}
