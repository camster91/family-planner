import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit-db";
import {
  syncSubscriptionExclusive,
  toSubscriptionDto,
} from "@/lib/calendar-import/sync";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/calendar/subscriptions/[id]/refresh — parents and teens.
// Fetches the feed now (subject to a per-subscription rate limit) and returns
// the updated status plus created/updated/deleted counts. No event content.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const role = auth.user.role;
    if (role !== "parent" && role !== "teen") {
      return NextResponse.json(
        { error: "Only parents and teens can refresh calendars" },
        { status: 403 },
      );
    }
    const { id } = await context.params;

    const existing = await prisma!.calendarSubscription.findFirst({
      where: { id, family_id: auth.user.family_id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Calendar subscription not found" },
        { status: 404 },
      );
    }

    const limit = await checkRateLimit(
      `calsub-refresh:${existing.id}`,
      6,
      10 * 60 * 1000,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: "This calendar was refreshed a moment ago. Try again shortly.",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
          },
        },
      );
    }

    const result = await syncSubscriptionExclusive(
      existing.id,
      auth.user.family_id,
    );
    if (!result) {
      return NextResponse.json(
        { error: "Calendar subscription not found" },
        { status: 404 },
      );
    }

    const sub = await prisma!.calendarSubscription.findFirst({
      where: { id: existing.id, family_id: auth.user.family_id },
      select: {
        id: true,
        name: true,
        color: true,
        url_enc: true,
        last_fetched_at: true,
        last_status: true,
        last_error: true,
        created_at: true,
      },
    });
    return NextResponse.json({
      result,
      subscription: sub
        ? toSubscriptionDto(sub, { includeUrlHint: role === "parent" })
        : null,
    });
  } catch {
    console.error("Error refreshing calendar subscription");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
