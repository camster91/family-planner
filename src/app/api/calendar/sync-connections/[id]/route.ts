import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import {
  changeD1CalendarConnection,
  clearD1CalendarConnection,
  d1ConnectionDto,
  readD1CalendarConnectionSecret,
  updateD1CalendarPushMode,
} from "@/lib/cloudflare/calendar-connections";
import {
  listD1ConnectionCalendars,
  NativeConnectionNotReadyError,
  revokeD1ProviderGrant,
} from "@/lib/cloudflare/calendar-two-way-sync";
import { getProviderConfig, isProvider } from "@/lib/calendar-sync/config";
import {
  authParentForSync,
  json,
  notFound,
} from "@/lib/calendar-sync/route-helpers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const PUSH_MODES = ["linked", "all"] as const;

const patchSchema = z
  .object({
    calendar_id: z.string().trim().min(1).max(1024).optional(),
    push_mode: z.enum(PUSH_MODES).optional(),
  })
  .refine((v) => v.calendar_id !== undefined || v.push_mode !== undefined, {
    message: "Nothing to change",
  });

const NOT_FOUND = { error: "Connected calendar not found" };

// PATCH /api/calendar/sync-connections/[id] — the connecting member only (#264).
// Choose which provider calendar to sync ({ calendar_id }) and whether new
// family events are pushed to it ({ push_mode: 'linked' | 'all' }). Another
// parent in the household cannot change these: it is that member's personal
// account. Foreign ids are 404.
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authParentForSync(request);
    if (error) return error;
    const { id } = await context.params;
    const familyId = auth.user.family_id;
    const backend = storageBackend();

    const nativeActor = {
      userId: auth.user.id,
      familyId,
      role: auth.user.role,
      generation: auth.payload.tv ?? 0,
    };
    const conn =
      backend === "d1"
        ? await readD1CalendarConnectionSecret(nativeActor, id)
        : await prisma!.calendarConnection.findFirst({
            where: { id, family_id: familyId },
            select: {
              id: true,
              user_id: true,
              provider: true,
              calendar_id: true,
            },
          });
    if (!conn) return json(NOT_FOUND, 404);
    if (conn.user_id !== auth.user.id) {
      return json(
        { error: "Only the member who connected this calendar can change it" },
        403,
      );
    }
    if (!isProvider(conn.provider) || !getProviderConfig(conn.provider))
      return notFound();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success)
      return json({ error: parsed.error.issues[0].message }, 400);

    const wanted = parsed.data.calendar_id;
    if (wanted !== undefined && wanted !== conn.calendar_id) {
      // Only a calendar this account can write to may be chosen.
      let calendars;
      const NotReadyError =
        backend === "d1"
          ? NativeConnectionNotReadyError
          : (await import("@/lib/calendar-sync/sync")).ConnectionNotReadyError;
      try {
        calendars =
          backend === "d1"
            ? await listD1ConnectionCalendars(nativeActor, conn.id)
            : await (
                await import("@/lib/calendar-sync/sync")
              ).listConnectionCalendars(conn.id, familyId);
      } catch (err) {
        if (err instanceof NotReadyError)
          return json({ error: "Reconnect this calendar first" }, 409);
        return json(
          { error: "Could not load calendars from the provider" },
          502,
        );
      }
      const chosen = (calendars ?? []).find(
        (c) => c.id === wanted && c.canWrite,
      );
      if (!chosen)
        return json({ error: "Choose one of your writable calendars" }, 400);
      if (backend === "d1")
        await changeD1CalendarConnection(nativeActor, conn.id, {
          id: chosen.id,
          name: chosen.name.slice(0, 120),
        });
      else
        await (
          await import("@/lib/calendar-sync/sync")
        ).changeCalendar(prisma, conn.id, familyId, {
          id: chosen.id,
          name: chosen.name.slice(0, 120),
        });
    }

    if (parsed.data.push_mode !== undefined) {
      if (backend === "d1")
        await updateD1CalendarPushMode(
          nativeActor,
          conn.id,
          parsed.data.push_mode,
        );
      else
        await prisma!.calendarConnection.updateMany({
          where: { id: conn.id, family_id: familyId },
          data: { push_mode: parsed.data.push_mode },
        });
    }

    const row =
      backend === "d1"
        ? await readD1CalendarConnectionSecret(nativeActor, conn.id)
        : await prisma!.calendarConnection.findFirst({
            where: { id: conn.id, family_id: familyId },
            select: (await import("@/lib/calendar-sync/sync"))
              .CONNECTION_DTO_SELECT,
          });
    return json({
      connection: row
        ? backend === "d1"
          ? d1ConnectionDto(row as any, auth.user.id)
          : (await import("@/lib/calendar-sync/sync")).toConnectionDto(
              row,
              auth.user.id,
            )
        : null,
    });
  } catch {
    console.error("Error updating calendar connection");
    return json({ error: "Internal server error" }, 500);
  }
}

// DELETE /api/calendar/sync-connections/[id] — any parent in the household.
// Revokes the grant at the provider (best effort), then deletes the tokens,
// the events imported from it, its links and the connection.
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authParentForSync(request);
    if (error) return error;
    const { id } = await context.params;
    const backend = storageBackend();
    if (backend === "d1") {
      const actor = {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        role: auth.user.role,
        generation: auth.payload.tv ?? 0,
      };
      const conn = await readD1CalendarConnectionSecret(actor, id);
      if (!conn) return json(NOT_FOUND, 404);
      await revokeD1ProviderGrant(conn, auth.user.family_id);
      const removedEvents = await clearD1CalendarConnection(actor, id);
      if (removedEvents === null) return json(NOT_FOUND, 404);
      return json({ success: true, removed_events: removedEvents });
    }
    const { removeConnection } = await import("@/lib/calendar-sync/sync");
    const result = await removeConnection(id, auth.user.family_id);
    if (!result) return json(NOT_FOUND, 404);
    return json({ success: true, removed_events: result.removedEvents });
  } catch {
    console.error("Error removing calendar connection");
    return json({ error: "Internal server error" }, 500);
  }
}
