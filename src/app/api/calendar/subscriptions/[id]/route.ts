import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import {
  removeSubscription,
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
    { status: 404 },
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
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const existing = await prisma!.calendarSubscription.findFirst({
      where: { id, family_id: auth.user.family_id },
      select: { id: true },
    });
    if (!existing) return NOT_FOUND();

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.color !== undefined) data.color = parsed.data.color;
    const updated = await prisma!.calendarSubscription.update({
      where: { id: existing.id },
      data,
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
      subscription: toSubscriptionDto(updated, { includeUrlHint: true }),
    });
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

    const existing = await prisma!.calendarSubscription.findFirst({
      where: { id, family_id: auth.user.family_id },
      select: { id: true },
    });
    if (!existing) return NOT_FOUND();

    const removedEvents = await removeSubscription(
      prisma!,
      existing.id,
      auth.user.family_id,
    );
    return NextResponse.json({ success: true, removedEvents });
  } catch {
    console.error("Error removing calendar subscription");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
