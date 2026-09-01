import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { notificationPreferencesSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateRequest(request);
  if (error) return error;

  const user = await prisma!.user.findUnique({
    where: { id: auth.userId },
    select: {
      notify_chores: true,
      notify_events: true,
      notify_messages: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    notifications: {
      choreUpdates: user.notify_chores,
      eventUpdates: user.notify_events,
      newMessages: user.notify_messages,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const [auth, error] = await authenticateRequest(request);
  if (error) return error;

  const parsed = notificationPreferencesSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid preferences" },
      { status: 400 },
    );
  }

  const user = await prisma!.user.update({
    where: { id: auth.userId },
    data: {
      notify_chores: parsed.data.choreUpdates,
      notify_events: parsed.data.eventUpdates,
      notify_messages: parsed.data.newMessages,
    },
    select: { family_id: true },
  });

  if (user.family_id) {
    await prisma!.auditLog.create({
      data: {
        family_id: user.family_id,
        actor_id: auth.userId,
        action: "account.notification_preferences_updated",
        resource_type: "User",
        resource_id: auth.userId,
        metadata: parsed.data,
      },
    });
  }

  return NextResponse.json({ notifications: parsed.data });
}
