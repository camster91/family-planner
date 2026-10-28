import { mutateD1Event, D1EventReceiptError } from "@/lib/cloudflare/event-mutations";
import { recordBetaMetric } from "@/lib/beta-metrics";
import { storageBackend } from "@/lib/storage-backend";
import { readD1CalendarEvents } from "@/lib/cloudflare/calendar-events";
import { CALENDAR_OWNER_HEADER, CALENDAR_OWNER_PROTOCOL, readCalendarOwner, sameCalendarOwner, type CalendarReadOwner } from "@/lib/calendar-read-owner";
import { projectEventCreators } from "@/lib/event-people";
import { assistantDeleteTargetGuard } from "@/lib/assistant-delete-target";
import {
  deletePersonRecord,
  authorizePersonDeleteReplay,
} from "@/lib/person-record-delete";
import {
  assistantSourceGuard,
  AssistantSourceRefused,
} from "@/lib/assistant-source-proof";
import { guardReviewDocumentSubmission } from "@/lib/review-document-submit-server";
import { withRouteTelemetry } from "@/lib/route-telemetry";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  authenticateWithFamily,
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
import { readIdempotencyKey, withIdempotency, idempotencyError } from "@/lib/idempotency";
import { updatePersonEvent } from "@/lib/person-event-update";
import { createPersonEvent, authorizePersonEventCreationReplay } from "@/lib/person-event-create";
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
    const original: Readonly<CalendarReadOwner> = Object.freeze({ protocol: CALENDAR_OWNER_PROTOCOL, actorId: auth.user.id, familyId: auth.user.family_id,
      role: auth.user.role, generation: auth.payload.tv ?? 0 });
    const scopeChanged = () => NextResponse.json({
      error: "Your account or household changed. Reload the calendar.", code: "EVENT_SCOPE_CHANGED",
    }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    // Old clients may omit comparison metadata. A client that supplies it must
    // never silently rebind its original read to a different current owner.
    const expected = request.headers.get(CALENDAR_OWNER_HEADER);
    if (expected !== null && !sameCalendarOwner(readCalendarOwner(expected), original)) return scopeChanged();
    const reply = async (body: unknown) => {
      const [current, refused] = await authenticateWithFamily(request);
      if (refused) { refused.headers.set("Cache-Control", "private, no-store"); return refused; }
      if (current.user.id !== original.actorId || current.user.family_id !== original.familyId ||
        current.user.role !== original.role || (current.payload.tv ?? 0) !== original.generation)
        return scopeChanged();
      return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store",
        [CALENDAR_OWNER_HEADER]: JSON.stringify(original) } });
    };

    const { searchParams } = new URL(request.url);

    const id = searchParams.get("id");
    if (searchParams.has("id")) {
      if (!id || searchParams.getAll("id").length !== 1)
        return NextResponse.json({ error: "Invalid event target" }, { status: 400 });
      if (storageBackend() === "d1") {
        const [event] = await readD1CalendarEvents(original, { id });
        if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
        return await reply({ event });
      }
      const event = await prisma!.event.findFirst({
        where: { id, family_id: original.familyId },
      });
      if (!event) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }
      const [withSource] = await attachEventSources(
        prisma!,
        original.familyId,
        await projectEventCreators(prisma!, original.familyId, [event]),
      );
      return await reply({ event: withSource });
    }

    let range;
    try {
      range = parseCalendarRange(searchParams, original.familyId);
    } catch (error) {
      if (error instanceof CalendarRangeError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    if (range) {
      const { start, end, limit, after } = range;
      const events = storageBackend() === "d1" ? await readD1CalendarEvents(original, { range }) : await prisma!.event.findMany({
        where: {
          family_id: original.familyId,
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
        orderBy: [{ start_time: "asc" }, { id: "asc" }],
        take: limit + 1,
      });
      const page = events.slice(0, limit);
      const hasMore = events.length > limit;
      return await reply({
        events: storageBackend() === "d1" ? page : await attachEventSources(prisma!, original.familyId, await projectEventCreators(prisma!, original.familyId, page)),
        nextCursor: hasMore
          ? encodeCalendarCursor(
              original.familyId,
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
    const where: Record<string, unknown> = { family_id: original.familyId };
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

    const events = storageBackend() === "d1" ? await readD1CalendarEvents(original, { upcoming }) : await prisma!.event.findMany({
      where,
      orderBy: [{ start_time: "asc" }, { id: "asc" }],
      take: 100,
    });

    // Imported events carry `source` ({ subscription_id, name, color }) and are read-only (#232).
    return await reply({
      events: storageBackend() === "d1" ? events : await attachEventSources(prisma!, original.familyId, await projectEventCreators(prisma!, original.familyId, events)),
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

    const actor = {
      familyId: auth.user.family_id, userId: auth.user.id,
      tokenVersion: auth.payload.tv ?? 0, name: auth.user.name,
    };
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
    if (storageBackend() === "d1") {
      // Portable source-grounding verification is a separate migration domain.
      // Never treat the proof's presence as permission to skip its checks.
      if (sourceGuard) throw new AssistantSourceRefused();
      const result = await mutateD1Event({ userId: actor.userId, familyId: actor.familyId, generation: actor.tokenVersion, name: actor.name },
        { kind: "create", input: parsed.data }, key);
      if (result.created) await recordBetaMetric(prisma!, actor.familyId, "event_created");
      return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "private, no-store", ...(result.replayed ? { "Idempotency-Replayed": "true" } : {}) } });
    }
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
          actor,
          recordId,
          sourceGuard,
        ),
      {
        beforeReplay: () =>
          authorizePersonEventCreationReplay(prisma!, actor, sourceGuard),
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof AssistantSourceRefused) return error.response();
    if (error instanceof D1EventReceiptError) return idempotencyError(error.code);
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
    if (storageBackend() === "d1") {
      if (sourceGuard || targetGuard) throw new AssistantSourceRefused();
      const result = await mutateD1Event(actor, { kind: "delete", eventId: parsed.data.eventId }, key);
      return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "private, no-store", ...(result.replayed ? { "Idempotency-Replayed": "true" } : {}) } });
    }
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
    if (error instanceof D1EventReceiptError) return idempotencyError(error.code);
    logRouteError("DELETE /api/events", error, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
