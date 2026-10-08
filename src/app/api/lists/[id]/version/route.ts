import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { listVersion } from "@/lib/list-version";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

/** Person sessions only, canonical owned list, metadata only, rate limited across lists. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    const gate = await featureGate(auth.user.family_id, "lists");
    if (gate) {
      gate.headers.set("Cache-Control", "private, no-store");
      return gate;
    }
    const { id } = await context.params;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
      return NextResponse.json(
        { error: "List not found" },
        { status: 404, headers: HEADERS },
      );
    const limit = await checkRateLimit(
      `list-version:${auth.user.id}`,
      1200,
      60 * 60 * 1000,
    );
    if (!limit.allowed)
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            ...HEADERS,
            "Retry-After": String(
              Math.max(1, Math.ceil(limit.retryAfterMs / 1000)),
            ),
          },
        },
      );
    const list = await prisma!.list.findFirst({
      where: { id, family_id: auth.user.family_id },
      select: {
        id: true,
        updated_at: true,
        items: { select: { id: true, updated_at: true } },
      },
    });
    if (!list)
      return NextResponse.json(
        { error: "List not found" },
        { status: 404, headers: HEADERS },
      );
    return NextResponse.json(
      { version: listVersion(list, list.items) },
      { headers: HEADERS },
    );
  } catch (error) {
    logRouteError("GET /api/lists/[id]/version", error, getRequestId(request));
    return NextResponse.json(
      { error: "Could not check for changes" },
      { status: 500, headers: HEADERS },
    );
  }
}
