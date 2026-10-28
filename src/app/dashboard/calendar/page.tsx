import { CALENDAR_OWNER_PROTOCOL, calendarOwnerSchema } from "@/lib/calendar-read-owner";
import { after } from "next/server";
import { readEventNotificationFocus } from "@/lib/event-notification-focus";
import { getServerActor } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { isCalendarSyncEnabled } from "@/lib/calendar-sync/config";
import { refreshStaleConnections } from "@/lib/calendar-sync/sync";
import { canImportEvents, isEventImportConfigured } from "@/lib/event-import";
import { parsePlanningDate, dayKey } from "@/lib/calendar-planning/view";
import { isParentRole } from "@/lib/role-capabilities";
import CalendarPageClient from "./CalendarPageClient";

interface CalendarPageProps {
  searchParams: Promise<{
    capture?: string | string[];
    focus?: string | string[];
    month?: string;
    year?: string;
    date?: string;
    view?: string;
  }>;
}

export default async function CalendarPage({
  searchParams,
}: CalendarPageProps) {
  const params = await searchParams;
  const sessionUser = await getServerActor();

  if (!sessionUser) {
    return null;
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { family_id: true, role: true, token_version: true },
  });

  if (user?.role !== "parent" && user?.role !== "teen") return null;
  const familyId = user.family_id;
  if (!familyId || user.family_id !== sessionUser.family_id || user.role !== sessionUser.role ||
    user.token_version !== sessionUser.tokenVersion) return null;
  const parsedOwner = calendarOwnerSchema.safeParse({ protocol: CALENDAR_OWNER_PROTOCOL,
    actorId: sessionUser.id, familyId, role: user.role, generation: sessionUser.tokenVersion });
  if (!parsedOwner.success) return null;
  const owner = parsedOwner.data;

  // Two-way Google/Microsoft sync (#264): opportunistic, after the response is
  // sent, at most once per connection per 5 minutes (DB-backed lease). No
  // scheduler (AGENTS.md). Dormant unless calendar sync is configured.
  if (familyId && isCalendarSyncEnabled()) {
    const syncFamilyId = familyId;
    after(() => refreshStaleConnections(syncFamilyId));
  }

  // Month/year come from the URL. With none (or a hand-edited/truncated value
  // like ?month=abc or ?month=13) the server falls back to its own UTC month;
  // the client then moves to the viewer's local month if that differs (O-31).
  const now = new Date();
  const monthParam = Number(params.month);
  const yearParam = Number(params.year);
  const validMonth =
    Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12;
  const validYear =
    Number.isInteger(yearParam) && yearParam >= 1970 && yearParam <= 9999;
  const month = validMonth ? monthParam : now.getUTCMonth() + 1;
  const year = validYear ? yearParam : now.getUTCFullYear();

  let notificationFocus: { target: Awaited<ReturnType<typeof readEventNotificationFocus>> } | undefined;
  if (params.focus !== undefined) {
    let target: Awaited<ReturnType<typeof readEventNotificationFocus>> = null;
    try {
      target = await readEventNotificationFocus(prisma!, {
        userId: owner.actorId, familyId: owner.familyId, role: owner.role, tokenVersion: owner.generation,
      }, params.focus);
    } catch { /* All unsupported/failed targets retain the neutral fallback. */ }
    notificationFocus = { target };
  }

  // UTC-only SSR shell: viewer-local ranges are fetched after mount through the
  // reviewed bounded/paged API. Never serialize a partial start-only month list.
  // A verified notification target is a client-local fallback only when the
  // link does not already name a date or legacy month; explicit navigation wins.
  const explicitDate = parsePlanningDate(params.date);
  const initialDate =
    explicitDate ||
    (validMonth
      ? `${year}-${String(month).padStart(2, "0")}-01`
      : dayKey(now, false));
  const focusStart =
    !explicitDate && !validMonth ? notificationFocus?.target?.start : undefined;
  const initialView =
    params.view === "day" ||
    params.view === "week" ||
    params.view === "agenda" ||
    params.view === "month"
      ? params.view
      : undefined;

  // Do not serialize the focused private record after a membership/role or
  // revocation change while its read was waiting. Browser reads retain this
  // exact original owner instead of adopting a newer server refresh.
  const current = await prisma!.user.findUnique({ where: { id: owner.actorId },
    select: { family_id: true, role: true, token_version: true } });
  if (!current || current.family_id !== owner.familyId || current.role !== owner.role ||
    current.token_version !== owner.generation) return null;

  return (
    <CalendarPageClient
      events={[]}
      initialOwner={owner}
      captureRequested={params.capture === "1"}
      canCreateEvents={canImportEvents(user?.role)}
      notificationFocus={notificationFocus}
      focusStart={focusStart}
      initialDate={initialDate}
      initialView={initialView}
      currentMonth={month}
      currentYear={year}
      // Without a month in the URL the client picks the viewer's local month.
      monthFromUrl={validMonth || !!explicitDate}
      // Review-first import (#270): hidden unless the provider key is set and the viewer may import.
      importEnabled={isEventImportConfigured() && canImportEvents(user?.role)}
      // Edit and delete are parent-only in the API; a teen (O-37) only views and adds.
      canEditEvents={isParentRole(user?.role)}
      calendarSyncAvailable={
        isParentRole(user?.role) && isCalendarSyncEnabled()
      }
    />
  );
}
