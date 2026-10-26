import { readBoundedJson, RequestBodyTooLargeError } from "@/lib/bounded-body";
import {
  withCalendarSubscriptionAccess,
  protectCalendarSubscriptionResponse,
  calendarSubscriptionAccessHeld,
  lockCalendarSubscriptionInTx,
  type CalendarSubscriptionActor,
} from "@/lib/calendar-subscription-access";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import {
  removeSubscriptionInTx,
  toSubscriptionDto,
} from "@/lib/calendar-import/sync";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give the calendar a name")
      .max(60, "Name is too long")
      .optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Colour must look like #1a2b3c")
      .nullable()
      .optional(),
  })
  .strict();

const NOT_FOUND = () =>
  NextResponse.json(
    { error: "Calendar subscription not found" },
    { status: 404, headers: { "Cache-Control": "private, no-store" } },
  );

// PATCH /api/calendar/subscriptions/[id] — rename / recolour. Parents only.
// The URL cannot be changed; remove and re-add instead.
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const parentError = requireParent(auth.user.role);
    if (parentError) return parentError;
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await readBoundedJson(request, 4096);
    } catch (cause) {
      return NextResponse.json({ error: cause instanceof RequestBodyTooLargeError ? "Request body too large" : "Invalid JSON" },
        { status: cause instanceof RequestBodyTooLargeError ? 413 : 400, headers: { "Cache-Control": "private, no-store" } });
    }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const actor: CalendarSubscriptionActor = {
      userId: auth.user.id, familyId: auth.user.family_id,
      role: auth.user.role, generation: auth.payload.tv ?? 0,
    };
    const result = await withCalendarSubscriptionAccess(prisma!, actor, "manage", async tx => {
      if (!await lockCalendarSubscriptionInTx(tx, id, actor.familyId)) return null;
      const data: Record<string, unknown> = {};
      if (parsed.data.name !== undefined) data.name = parsed.data.name;
      if (parsed.data.color !== undefined) data.color = parsed.data.color;
      const updated = await tx.calendarSubscription.update({
        where: { id, family_id: actor.familyId }, data,
        select: { id: true, name: true, color: true, url_enc: true, last_fetched_at: true,
          last_status: true, last_error: true, created_at: true },
      });
      return toSubscriptionDto(updated, { includeUrlHint: true });
    });
    if (result.kind === "held") return calendarSubscriptionAccessHeld();
    if (!result.value) return NOT_FOUND();
    return protectCalendarSubscriptionResponse(prisma!, actor, "manage", NextResponse.json({ subscription: result.value }));
  } catch {
    console.error("Error updating calendar subscription");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE /api/calendar/subscriptions/[id] — parents only. Deletes the
// subscription and ONLY the events it imported; local events are untouched.
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const parentError = requireParent(auth.user.role);
    if (parentError) return parentError;
    const { id } = await context.params;

    const actor: CalendarSubscriptionActor = {
      userId: auth.user.id, familyId: auth.user.family_id,
      role: auth.user.role, generation: auth.payload.tv ?? 0,
    };
    const result = await withCalendarSubscriptionAccess(prisma!, actor, "manage", async tx => {
      if (!await lockCalendarSubscriptionInTx(tx, id, actor.familyId)) return null;
      return { removedEvents: await removeSubscriptionInTx(tx, id, actor.familyId) };
    });
    if (result.kind === "held") return calendarSubscriptionAccessHeld();
    if (!result.value) return NOT_FOUND();
    return protectCalendarSubscriptionResponse(prisma!, actor, "manage", NextResponse.json({ success: true, ...result.value }));
  } catch {
    console.error("Error removing calendar subscription");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
