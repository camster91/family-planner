import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import {
  buildD1CalendarFeed,
  D1CalendarFeedInvalidRule,
  D1CalendarFeedTooLarge,
} from "@/lib/cloudflare/calendar-feed";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { CalendarFeedInvalidRule } from "@/lib/calendar-feed-rule";
import { buildCalendarFeed, CalendarFeedTooLarge } from "@/lib/calendar-feed";

export const dynamic = "force-dynamic";

// Read-only token feed. Assemble a complete bounded snapshot before emitting ICS.
export async function GET(request: NextRequest) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token)
      return NextResponse.json(
        { error: "Missing feed token" },
        { status: 401 },
      );
    const now = new Date();
    const feed =
      storageBackend() === "d1"
        ? await buildD1CalendarFeed(token, now)
        : await prisma!.$transaction(
            (tx) => buildCalendarFeed(tx, token, now),
            {
              isolationLevel: "RepeatableRead",
              timeout: 30000,
            },
          );
    if (feed.kind === "unauthorized")
      return NextResponse.json(
        { error: "Invalid feed token" },
        { status: 401 },
      );
    return new NextResponse(feed.ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    if (
      error instanceof CalendarFeedTooLarge ||
      error instanceof D1CalendarFeedTooLarge
    )
      return NextResponse.json(
        {
          code: "CALENDAR_FEED_TOO_LARGE",
          error: "This calendar is too large to export completely right now.",
        },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    if (
      error instanceof CalendarFeedInvalidRule ||
      error instanceof D1CalendarFeedInvalidRule
    )
      return NextResponse.json(
        {
          code: "CALENDAR_FEED_INVALID_RULE",
          error:
            "This calendar has a recurrence rule that needs review before export.",
        },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    logRouteError("GET /api/calendar/feed", error, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
