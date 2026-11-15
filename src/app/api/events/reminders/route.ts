import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateRequest } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
import { storageBackend } from "@/lib/storage-backend";
import { DEFAULT_REMINDER_LEAD_HOURS, REMINDER_LEAD_HOURS, eventRemindersReady, isReminderLeadHours } from "@/lib/event-reminders";
import { readReminderLeadHours, writeReminderLeadHours } from "@/lib/event-reminders-db";
import { readD1ReminderLeadHours, writeD1ReminderLeadHours } from "@/lib/cloudflare/event-reminders";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };
const patchSchema = z.object({ hours: z.number().refine(isReminderLeadHours, { message: "Choose one of the offered reminder times" }) }).strict();

/**
 * GET - how far ahead the signed-in account is reminded about events
 * (in-app reminders). Own setting only; there is no way to name another
 * person. `supported: false` (capability off) is an explicit answer: clients
 * hide the control.
 */
export async function GET(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request);
    if (deviceRefusal) return deviceRefusal;
    const [payload, error] = await authenticateRequest(request);
    if (error) return error;
    if (!eventRemindersReady()) return NextResponse.json({ supported: false, hours: DEFAULT_REMINDER_LEAD_HOURS, options: [] }, { headers: NO_STORE });
    const actor = { userId: payload.userId, generation: payload.tv ?? 0 };
    const hours = storageBackend() === "d1" ? await readD1ReminderLeadHours(actor) : await readReminderLeadHours(prisma!, actor.userId);
    if (hours === null) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    return NextResponse.json({ supported: true, hours, options: REMINDER_LEAD_HOURS }, { headers: NO_STORE });
  } catch (error) {
    logRouteError("GET /api/events/reminders", error, getRequestId(request));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** PATCH { hours } - set the signed-in account's own lead time. Explicit value, so a repeat converges. */
export async function PATCH(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request);
    if (deviceRefusal) return deviceRefusal;
    const [payload, error] = await authenticateRequest(request);
    if (error) return error;
    if (!eventRemindersReady())
      return NextResponse.json({ error: "Event reminders are not available yet.", code: "EVENT_REMINDERS_UNSUPPORTED" }, { status: 409, headers: NO_STORE });
    let input: unknown;
    try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE }); }
    const parsed = patchSchema.safeParse(input);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
    const actor = { userId: payload.userId, generation: payload.tv ?? 0 };
    const hours = parsed.data.hours as (typeof REMINDER_LEAD_HOURS)[number];
    const saved = storageBackend() === "d1" ? await writeD1ReminderLeadHours(actor, hours) : await writeReminderLeadHours(prisma!, actor, hours);
    if (!saved) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    return NextResponse.json({ supported: true, hours, options: REMINDER_LEAD_HOURS }, { headers: NO_STORE });
  } catch (error) {
    logRouteError("PATCH /api/events/reminders", error, getRequestId(request));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
