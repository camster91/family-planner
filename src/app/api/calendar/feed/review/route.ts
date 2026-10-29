import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import { getD1Database } from "@/lib/cloudflare/database";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import {
  CALENDAR_FEED_REVIEW_PAGE_SIZE,
  CALENDAR_FEED_REVIEW_SCOPE_HEADER,
  calendarFeedReviewPage,
} from "@/lib/calendar-feed-review-contract";
import {
  feedReviewCursor,
  parseFeedReviewCursor,
  feedRuleNeedsReview,
} from "@/lib/calendar-feed-review";
export const dynamic = "force-dynamic";
async function handle(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const denied = requireParent(auth.user.role);
    if (denied) return denied;
    const expectedFamily = request.headers.get(
      CALENDAR_FEED_REVIEW_SCOPE_HEADER,
    );
    if (!expectedFamily || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedFamily))
      return NextResponse.json(
        { error: "Household review context required" },
        { status: 400 },
      );
    if (expectedFamily !== auth.user.family_id)
      return NextResponse.json(
        { error: "Household changed; reload Settings" },
        { status: 409 },
      );
    let after: string | null;
    try {
      after = parseFeedReviewCursor(
        new URL(request.url).searchParams,
        auth.user.family_id,
      );
    } catch {
      return NextResponse.json(
        { error: "Invalid feed review cursor" },
        { status: 400 },
      );
    }
    const rows =
      storageBackend() === "d1"
        ? (
            await (
              await getD1Database()
            )
              .withSession("first-primary")
              .prepare(
                `SELECT e.id,e.title,e.recurrence,e.source_connection_id,e.source_subscription_id
        FROM "Event" e WHERE e.family_id=?2 AND e.recurrence IS NOT NULL
        AND EXISTS (SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id WHERE u.id=?1 AND u.family_id=?2 AND u.role='parent' AND u.token_version=?4)
        ${after ? "AND e.id>?5" : ""} ORDER BY e.id LIMIT ?${after ? 6 : 5}`,
              )
              .bind(
                auth.user.id,
                auth.user.family_id,
                "parent",
                auth.payload.tv ?? 0,
                ...(after ? [after] : []),
                CALENDAR_FEED_REVIEW_PAGE_SIZE + 1,
              )
              .all<{
                id: string;
                title: string;
                recurrence: string;
                source_connection_id: string | null;
                source_subscription_id: string | null;
              }>()
          ).results
        : await prisma!.event.findMany({
            where: {
              family_id: auth.user.family_id,
              recurrence: { not: null },
              ...(after ? { id: { gt: after } } : {}),
            },
            select: {
              id: true,
              title: true,
              recurrence: true,
              source_connection_id: true,
              source_subscription_id: true,
            },
            orderBy: { id: "asc" },
            take: CALENDAR_FEED_REVIEW_PAGE_SIZE + 1,
          });
    const page = rows.slice(0, CALENDAR_FEED_REVIEW_PAGE_SIZE);
    const result = calendarFeedReviewPage.parse({
      checked: page.length,
      issues: page
        .filter((row) => feedRuleNeedsReview(row.recurrence!))
        .map((row) => ({
          id: row.id,
          title: row.title,
          source: row.source_connection_id
            ? "connected"
            : row.source_subscription_id
              ? "subscribed"
              : "local",
        })),
      nextCursor:
        rows.length > page.length
          ? feedReviewCursor(auth.user.family_id, page[page.length - 1].id)
          : null,
    });
    return NextResponse.json(result);
  } catch (error) {
    logRouteError(
      "GET /api/calendar/feed/review",
      error,
      getRequestId(request),
    );
    return NextResponse.json(
      { error: "Calendar recurrence review is unavailable" },
      { status: 500 },
    );
  }
}
export async function GET(request: NextRequest) {
  const response = await handle(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
