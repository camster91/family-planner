import { assistantDeleteTargetGuard } from "@/lib/assistant-delete-target";
import {
  deletePersonRecord,
  authorizePersonDeleteReplay,
} from "@/lib/person-record-delete";
import {
  assistantSourceGuard,
  authorizeAssistantSourceReplay,
  AssistantSourceRefused,
} from "@/lib/assistant-source-proof";
import { guardReviewDocumentSubmission } from "@/lib/review-document-submit-server";
import { withRouteTelemetry } from "@/lib/route-telemetry";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  authenticateWithFamily,
  requireFamilyMatch,
  requireParent,
} from "@/lib/api-auth";
import {
  createEventSchema,
  updateEventSchema,
  deleteEventSchema,
} from "@/lib/validations";
import {
  attachEventSources,
} from "@/lib/calendar-import/source";
import { readIdempotencyKey, withIdempotency } from "@/lib/idempotency";
import { updatePersonEvent } from "@/lib/person-event-update";
import { createPersonEvent } from "@/lib/person-event-create";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import {
  CalendarRangeError,
  encodeCalendarCursor,
  parseCalendarRange,
} from "@/lib/calendar-planning/range";

export const dynamic = "force-dynamic";

/** GET without `upcoming`: how far back the list reaches (by event end). */
const LIST_WINDOW_PAST_DAYS = 30;

// GET - List events for the user's family, or fetch one with ?id=
export const GET = withRouteTelemetry("/api/events", handleGET);

async function handleGET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const { searchParams } = new URL(request.url);

    const id = searchParams.get("id");
    if (id) {
      const event = await prisma!.event.findUnique({
        where: { id },
        include: {
          creator: { select: { id: true, name: true } },
        },
      });
      if (!event) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }
      const familyError = requireFamilyMatch(
        event.family_id,
        auth.user.family_id,
      );
      if (familyError) return familyError;
      const [withSource] = await attachEventSources(
        prisma!,
        auth.user.family_id,
        [event],
      );
      return NextResponse.json({ event: withSource });
    }

    let range;
    try {
      range = parseCalendarRange(searchParams, auth.user.family_id);
    } catch (error) {
      if (error instanceof CalendarRangeError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    if (range) {
      const { start, end, limit, after } = range;
      const events = await prisma!.event.findMany({
        where: {
          family_id: auth.user.family_id,
          OR: [
            { start_time: { gte: start, lt: end } },
            { start_time: { lt: start }, end_time: { gt: start } },
          ],
          ...(after
            ? {
                AND: [
                  {
                    OR: [
                      { start_time: { gt: after.start } },
                      { start_time: after.start, id: { gt: after.id } },
                    ],
                  },
                ],
              }
            : {}),
        },
        include: { creator: { select: { id: true, name: true } } },
        orderBy: [{ start_time: "asc" }, { id: "asc" }],
        take: limit + 1,
      });
      const page = events.slice(0, limit);
      const hasMore = events.length > limit;
      return NextResponse.json({
        events: await attachEventSources(prisma!, auth.user.family_id, page),
        nextCursor: hasMore
          ? encodeCalendarCursor(
              auth.user.family_id,
              range,
              page[page.length - 1],
            )
          : null,
        hasMore,
      });
    }

    const upcoming = searchParams.get("upcoming") === "true";

    // `upcoming=true`: events starting from now. Otherwise a recent window:
    // events that end no earlier than LIST_WINDOW_PAST_DAYS ago (so ongoing
    // and recently finished ones are included), oldest first. Without the
    // window the list was the household's 100 OLDEST events ever, which hid
    // everything current once a household had more than 100.
    const where: Record<string, unknown> = { family_id: auth.user.family_id };
    if (upcoming) {
      where.start_time = { gte: new Date() };
    } else {
      // A repeating event is one row holding its first occurrence, so keep
      // every repeating event regardless of when the first one ended.
      where.OR = [
        {
          end_time: {
            gte: new Date(
              Date.now() - LIST_WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000,
            ),
          },
        },
        { recurrence: { not: null } },
      ];
    }

    const events = await prisma!.event.findMany({
      where,
      include: {
        creator: { select: { id: true, name: true } },
      },
      orderBy: [{ start_time: "asc" }, { id: "asc" }],
      take: 100,
    });

    // Imported events carry `source` ({ subscription_id, name, color }) and are read-only (#232).
    return NextResponse.json({
      events: await attachEventSources(prisma!, auth.user.family_id, events),
    });
  } catch (error) {
    logRouteError("GET /api/events", error, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST - Create an event
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const reviewRefusal = guardReviewDocumentSubmission(
      request,
      auth,
      "event.create",
    );
    if (reviewRefusal) return reviewRefusal;

    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = createEventSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const { start_time, end_time } = parsed.data;

    const startDate = new Date(start_time);
    const endDate = end_time ? new Date(end_time) : startDate;

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid start or end time" },
        { status: 400 },
      );
    }

    if (endDate < startDate) {
      return NextResponse.json(
        { error: "End time must be after start time" },
        { status: 400 },
      );
    }

    const sourceGuard = assistantSourceGuard(
      request,
      {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        role: auth.user.role,
        generation: auth.payload?.tv ?? 0,
      },
      "event_create",
    );
    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: "event.create",
      },
      parsed.data,
      ({ recordId }) =>
        createPersonEvent(
          prisma!,
          parsed.data,
          {
            familyId: auth.user.family_id,
            userId: auth.user.id,
            name: auth.user.name,
          },
          recordId,
          sourceGuard,
        ),
      {
        beforeReplay: () =>
          authorizeAssistantSourceReplay(prisma!, sourceGuard),
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof AssistantSourceRefused) return error.response();
    logRouteError("POST /api/events", error, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PATCH - Update an event (family-scoped)
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const parentError = requireParent(auth.user.role);
    if (parentError) return parentError;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = updateEventSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const result = await updatePersonEvent(prisma!, {
      userId: auth.user.id, familyId: auth.user.family_id, tokenVersion: auth.payload.tv ?? 0,
    }, parsed.data);
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logRouteError("PATCH /api/events", error, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE - Delete an event (family-scoped)
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const parentError = requireParent(auth.user.role);
    if (parentError) return parentError;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = deleteEventSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "eventId is required" },
        { status: 400 },
      );
    }

    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      generation: auth.payload?.tv ?? 0,
    };
    const kind = "event_delete" as const;
    const sourceGuard = assistantSourceGuard(request, actor, kind);
    const targetGuard = assistantDeleteTargetGuard(
      request,
      actor,
      kind,
      parsed.data.eventId,
      Boolean(sourceGuard),
    );
    return await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${actor.userId}`,
        userId: actor.userId,
        familyId: actor.familyId,
        action: "event.delete",
      },
      parsed.data,
      ({ recordId }) =>
        deletePersonRecord(
          prisma!,
          actor,
          kind,
          parsed.data.eventId,
          recordId,
          sourceGuard,
          targetGuard,
        ),
      { beforeReplay: () => authorizePersonDeleteReplay(prisma!, actor, kind) },
    );
  } catch (error) {
    if (error instanceof AssistantSourceRefused) return error.response();
    logRouteError("DELETE /api/events", error, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
