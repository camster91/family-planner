import { readChoreNotificationFocus } from "@/lib/chore-notification-focus";
import { readChoreStreaks } from "@/lib/chore-streak-read";
import {
  hiddenRoutineOccurrenceIds,
  scheduledOnceRoutineOccurrenceIds,
} from "@/lib/routine-occurrence-policy";
import { readVisibleChoreRows } from "@/lib/chore-visible-read";
import { publicChoreData } from "@/lib/chore-public-data";
import { ROUTINE_SCHEDULE_READY_ENV } from "@/lib/routine-schedule-gates";
import { getServerUser, getServerActor } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import ChoresContent from "./ChoresContent";
import { eventPreparationReady } from "@/lib/event-preparation/owner";
import {
  isGamificationOn,
  omitChorePoints,
} from "@/lib/gamification-visibility";
import {
  afterChoreCursor,
  CHORE_HISTORY_ORDER,
  CHORE_HISTORY_PAGE_SIZE,
  choreOrderBy,
  compareChoreOrder,
  currentChoreQueries,
  encodeChoreCursor,
} from "@/lib/chore-paging";
import { topUpHouseholdSeries } from "@/lib/recurringChores";
import { nextRotationMember } from "@/lib/chore-rotation-shared";
import {
  choreSubjectInclude,
  profileChoreActionAvailability,
  readChoreSubject,
} from "@/lib/chore-profile";

export default async function ChoresPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const sessionUser = await getServerUser();

  if (!sessionUser) {
    return null;
  }

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { family_id: true, role: true },
  });

  const familyId = user?.family_id || undefined;
  // Points & streaks (#248). When off, no chore points or streaks are computed
  // or sent to the client.
  const gamification = await isGamificationOn(familyId);

  // Recurring series are extended on read (there is no scheduler): a series
  // nobody ticks still shows its next weeks. Bounded, idempotent, never throws.
  if (familyId) await topUpHouseholdSeries(familyId);

  // Chores for the family (O-19 paging), bounded (`currentChoreQueries`):
  // open chores due in the last 60 days or later, verified chores due from
  // yesterday (UTC) on, and every chore waiting for a parent's check load in
  // full: the Today and Week views, the pending count and the verification
  // queue need them. Each of those reads is capped and drops the oldest rows
  // first. Older verified chores (history, seen under "All") are paged newest
  // first, in the same (due_date, id) order as
  // `GET /api/chores?limit=&cursor=&order=desc`, so the first page is the most
  // recent history and the client's "Load more" carries on, further back, from
  // `historyCursor`.
  const include = {
    ...choreSubjectInclude,
    creator: { select: { name: true } },
  } as const;
  const queries = familyId ? currentChoreQueries(familyId) : null;
  const [open, awaitingCheck, history] = queries
    ? await Promise.all([
        readVisibleChoreRows({
          take: queries.open.take,
          order: "desc",
          read: (after, batchSize) => prisma!.chore.findMany({
            where: after
              ? { AND: [queries.open.where, afterChoreCursor(after, "desc")] }
              : queries.open.where,
            include,
            orderBy: queries.open.orderBy,
            take: batchSize,
          }),
          hidden: (ids) => hiddenRoutineOccurrenceIds(prisma!, familyId!, { ids }),
        }),
        prisma!.chore.findMany({ ...queries.awaitingCheck, include }),
        prisma!.chore.findMany({
          where: {
            family_id: familyId,
            status: "verified",
            due_date: { lt: queries.historyBefore },
          },
          include,
          orderBy: choreOrderBy(CHORE_HISTORY_ORDER),
          take: CHORE_HISTORY_PAGE_SIZE + 1,
        }),
      ])
    : [[], [], []];
  const current = [...open, ...awaitingCheck];
  const historyHasMore = history.length > CHORE_HISTORY_PAGE_SIZE;
  const historyPage = historyHasMore
    ? history.slice(0, CHORE_HISTORY_PAGE_SIZE)
    : history;
  const historyCursor = historyHasMore
    ? encodeChoreCursor(historyPage[historyPage.length - 1])
    : null;
  const chores = [...historyPage, ...current].sort(compareChoreOrder);

  // Badge-only projection for displayed account assignees; no full completion history.
  // Profiles retain their own subject policy and never inherit an account streak.
  const streakMap = familyId && gamification
    ? await readChoreStreaks(prisma!, familyId, chores.map(chore => chore.assigned_to))
    : {};

  // Get family members for assignment
  const familyMembers = familyId
    ? await prisma!.user.findMany({
        where: { family_id: familyId },
        select: { id: true, name: true, role: true, age: true },
        orderBy: { role: "desc" },
      })
    : [];

  // Take turns (O-39): "Takes turns · next: Alex" on open rows of a rotating
  // series. One small read of the series templates on this page.
  const seriesIds = [
    ...new Set(
      chores
        .filter(
          (c) =>
            c.recurrence_id &&
            !["completed", "verified", "approved"].includes(c.status),
        )
        .map((c) => c.recurrence_id as string),
    ),
  ];
  const schedules = new Map<
    string,
    { frequency: string; weekly_days: number[] }
  >();
  const rotations = new Map<string, string[]>();
  if (familyId && seriesIds.length > 0) {
    const templates = await prisma!.chore.findMany({
      where: { family_id: familyId, id: { in: seriesIds }, is_template: true },
      select: {
        id: true,
        rotation_member_ids: true,
        frequency: true,
        weekly_days: true,
      },
    });
    for (const t of templates) {
      rotations.set(t.id, t.rotation_member_ids);
      schedules.set(t.id, {
        frequency: t.frequency,
        weekly_days: t.weekly_days,
      });
    }
  }
  const memberNames = new Map(familyMembers.map((m) => [m.id, m.name]));
  const rotationNextName = (c: (typeof chores)[number]): string | null => {
    if (
      !c.recurrence_id ||
      ["completed", "verified", "approved"].includes(c.status)
    )
      return null;
    const nextId = nextRotationMember(
      rotations.get(c.recurrence_id),
      c.rotation_index,
    );
    return nextId ? (memberNames.get(nextId) ?? null) : null;
  };

  const scheduledOnceIds = familyId
    ? await scheduledOnceRoutineOccurrenceIds(
        prisma!,
        familyId,
        chores
          .filter(
            (row) => row.assigned_to === null && row.assigned_member_id != null,
          )
          .map((row) => row.id),
      )
    : new Set<string>();
  const serializedChores = chores.map((c) => {
    const subject = familyId ? readChoreSubject(c, familyId) : null;
    const actionAvailability =
      subject?.kind === "profile"
        ? profileChoreActionAvailability(
            c,
            scheduledOnceIds.has(c.id) ? "scheduled-once" : "legacy",
          )
        : null;
    const {
      assigneeMember: _assigneeMember,
      assignee: _assignee,
      ...safeChore
    } = c;
    // The release owner regenerates Prisma in the migration checkout. Keep
    // this additive projection type-safe for the pre-generated client used by
    // older app builds while preserving the durable fields when present.
    const routineFields = c as typeof c & {
      routine_stack_id?: string | null;
      assigned_member_id?: string | null;
      member_subject_erased?: boolean;
      is_template?: boolean;
    };
    const row = {
      ...publicChoreData(safeChore),
      // Keep account/profile subjects display-only on this board. In
      // particular, never manufacture a User for an email-free member.
      assignee: subject ? { name: subject.name } : null,
      ...(subject?.kind === "profile" ? { subject } : {}),
      ...(actionAvailability ? { actionAvailability } : {}),
      due_date: c.due_date.toISOString(),
      created_at: c.created_at.toISOString(),
      completed_at: c.completed_at?.toISOString() ?? null,
      verified_at: c.verified_at?.toISOString() ?? null,
      photo_url: c.photo_url ?? null,
      routine_stack_id: routineFields.routine_stack_id ?? null,
      assigned_member_id: routineFields.assigned_member_id ?? null,
      member_subject_erased: routineFields.member_subject_erased ?? false,
      is_template: routineFields.is_template ?? false,
      streak: c.assigned_to ? (streakMap[c.assigned_to] ?? 0) : 0,
      rotation_next_name: rotationNextName(c),
      recurrence_frequency: c.recurrence_id
        ? (schedules.get(c.recurrence_id)?.frequency ?? null)
        : null,
      recurrence_weekly_days: c.recurrence_id
        ? (schedules.get(c.recurrence_id)?.weekly_days ?? [])
        : [],
    };
    return gamification ? row : omitChorePoints(row);
  });

  const params = (await searchParams) ?? {};
  let notificationFocus: { target: Awaited<ReturnType<typeof readChoreNotificationFocus>> } | undefined;
  if (params.focus !== undefined) {
    const actor = await getServerActor();
    const target = actor && actor.id === sessionUser.id && actor.family_id === familyId && actor.role === user?.role && familyId
      ? await readChoreNotificationFocus(prisma!, {
          userId: actor.id, familyId, role: actor.role!, tokenVersion: actor.tokenVersion,
        }, params.focus).catch(() => null)
      : null;
    notificationFocus = { target };
  }

  return (
    <ChoresContent
      notificationFocus={notificationFocus}
      preparationContextEnabled={
        Boolean(user && ["parent", "child", "teen"].includes(user.role)) &&
        eventPreparationReady()
      }
      chores={serializedChores as any}
      familyMembers={familyMembers as any}
      currentUserId={sessionUser.id}
      userRole={user?.role || "child"}
      familyId={familyId}
      routineSchedulesEnabled={
        user?.role === "parent" &&
        process.env[ROUTINE_SCHEDULE_READY_ENV] === "1"
      }
      historyCursor={historyCursor}
    />
  );
}
