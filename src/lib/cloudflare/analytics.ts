import type { EffectResult } from "@/lib/idempotency";
import {
  ANALYTICS_SUMMARY_COVERAGE,
  ANALYTICS_SUMMARY_LIMIT_CODE,
  ANALYTICS_WINDOW_DAYS,
  MAX_ANALYTICS_CHORES,
  MAX_ANALYTICS_MEMBERS,
} from "@/lib/analytics-summary-contract";
import {
  addDaysToKey,
  dayKeyFor,
  weekdayOfKey,
  type LocalZone,
} from "@/lib/local-day-key";
import { PRIVATE_TIMELINE_ACTIONS } from "@/lib/review-inbox/timeline-contract";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { hiddenD1RoutineOccurrenceIds } from "./chore-read-policy";
import { getD1Database, type D1Store } from "./database";

export type D1AnalyticsActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};

type ChoreRow = {
  id: string;
  assigned_to: string | null;
  status: string;
  points: number;
  difficulty: string;
  completed_at: number | null;
  due_date: number;
};

type MemberRow = {
  id: string;
  name: string;
  role: string;
  avatar_url: string | null;
  xp: number;
  level: number;
  streak: number;
  best_streak: number;
};

type ActivityRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  description: string | null;
  created_at: number;
  user_name: string | null;
};

const DONE = new Set(["completed", "verified"]);

function dateValue(value: number | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function familyJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function readVisibleChores(
  store: D1Store,
  familyId: string,
  from: Date,
  through: Date,
  limit: number,
): Promise<ChoreRow[]> {
  const db = store.withSession("first-primary");
  const rows: ChoreRow[] = [];
  let afterDue: number | null = null;
  let afterId: string | null = null;
  const pageSize = 200;
  while (rows.length < limit) {
    const page: { results: ChoreRow[] } = await db
      .prepare(
        `SELECT c.id,c.assigned_to,c.status,c.points,c.difficulty,c.completed_at,c.due_date
           FROM "Chore" c
          WHERE c.family_id=?1
            AND ((c.due_date>=?2 AND c.due_date<=?3)
              OR (c.status IN ('completed','verified') AND c.completed_at>=?2 AND c.completed_at<=?3))
            AND (?4 IS NULL OR c.due_date<?4 OR (c.due_date=?4 AND c.id>?5))
          ORDER BY c.due_date DESC,c.id ASC LIMIT ?6`,
      )
      .bind(
        familyId,
        from.getTime(),
        through.getTime(),
        afterDue,
        afterId,
        pageSize,
      )
      .all<ChoreRow>();
    if (!page.results.length) break;
    const hidden = new Set(
      await hiddenD1RoutineOccurrenceIds(
        familyId,
        { ids: page.results.map((row) => row.id) },
        store,
      ),
    );
    for (const row of page.results) {
      if (!hidden.has(row.id)) rows.push(row);
      if (rows.length === limit) return rows;
    }
    const last: ChoreRow = page.results.at(-1)!;
    afterDue = last.due_date;
    afterId = last.id;
    if (page.results.length < pageSize) break;
  }
  return rows;
}

function activityRows(
  db: D1Store,
  familyId: string,
): Promise<{ results: ActivityRow[] }> {
  const placeholders = PRIVATE_TIMELINE_ACTIONS.map(
    (_, index) => `?${index + 2}`,
  ).join(",");
  return db
    .prepare(
      `SELECT a.id,a.user_id,a.type,a.title,a.description,a.created_at,u.name AS user_name
         FROM "Activity" a JOIN "User" u ON u.id=a.user_id AND u.family_id=a.family_id
        WHERE a.family_id=?1
          AND (a.type NOT LIKE 'event\\_%' ESCAPE '\\' OR a.type='event_created')
          AND a.type NOT IN (${placeholders})
        ORDER BY a.created_at DESC LIMIT 10`,
    )
    .bind(familyId, ...PRIVATE_TIMELINE_ACTIONS)
    .all<ActivityRow>();
}

export async function readD1Analytics(
  actor: D1AnalyticsActor,
  options: { zone: LocalZone; summaryOnly: boolean; now?: Date },
  database?: D1Store,
): Promise<EffectResult> {
  const store = database ?? (await getD1Database());
  const db = store.withSession("first-primary");
  const now = options.now ?? new Date();
  const windowStart = new Date(
    now.getTime() - ANALYTICS_WINDOW_DAYS * 86400000,
  );
  const memberLimit = options.summaryOnly ? MAX_ANALYTICS_MEMBERS + 1 : null;
  const members = await db
    .prepare(
      `SELECT id,name,role,avatar_url,xp,level,streak,best_streak
         FROM "User" WHERE family_id=?1 ORDER BY id ASC${memberLimit ? " LIMIT ?2" : ""}`,
    )
    .bind(...(memberLimit ? [actor.familyId, memberLimit] : [actor.familyId]))
    .all<MemberRow>();
  const allChores = await readVisibleChores(
    store,
    actor.familyId,
    windowStart,
    now,
    MAX_ANALYTICS_CHORES + (options.summaryOnly ? 1 : 0),
  );
  const completed = await db
    .prepare(
      `SELECT id,assigned_to,status,points,difficulty,completed_at,due_date
         FROM "Chore"
        WHERE family_id=?1 AND status IN ('completed','verified')
          AND completed_at>=?2 AND completed_at<=?3
        ORDER BY completed_at DESC LIMIT ?4`,
    )
    .bind(
      actor.familyId,
      windowStart.getTime(),
      now.getTime(),
      MAX_ANALYTICS_CHORES + (options.summaryOnly ? 1 : 0),
    )
    .all<ChoreRow>();
  const activities = options.summaryOnly
    ? { results: [] as ActivityRow[] }
    : await activityRows(store, actor.familyId);
  const family = await db
    .prepare('SELECT features FROM "Family" WHERE id=?1')
    .bind(actor.familyId)
    .first<{ features: string | null }>();

  if (
    options.summaryOnly &&
    (members.results.length > MAX_ANALYTICS_MEMBERS ||
      allChores.length > MAX_ANALYTICS_CHORES ||
      completed.results.length > MAX_ANALYTICS_CHORES)
  )
    return {
      status: 422,
      body: {
        code: ANALYTICS_SUMMARY_LIMIT_CODE,
        error: "This progress view exceeds the supported summary size.",
      },
    };

  const dayKey = dayKeyFor(options.zone);
  const completedByDay = new Map<string, { count: number; points: number }>();
  for (const chore of completed.results) {
    const at = dateValue(chore.completed_at);
    if (!at) continue;
    const key = dayKey(at);
    const entry = completedByDay.get(key) ?? { count: 0, points: 0 };
    entry.count += 1;
    entry.points += chore.points || 0;
    completedByDay.set(key, entry);
  }
  const today = dayKey(now);
  const weeklyTrend = Array.from({ length: 7 }, (_, index) => {
    const date = addDaysToKey(today, index - 6);
    const entry = completedByDay.get(date);
    return {
      date,
      day: weekdayOfKey(date, "short"),
      count: entry?.count ?? 0,
      points: entry?.points ?? 0,
    };
  });
  const counts = new Map<string, { total: number; completed: number }>();
  for (const chore of allChores) {
    if (!chore.assigned_to) continue;
    const entry = counts.get(chore.assigned_to) ?? { total: 0, completed: 0 };
    entry.total += 1;
    if (DONE.has(chore.status)) entry.completed += 1;
    counts.set(chore.assigned_to, entry);
  }
  const participation = members.results.map((member) => {
    const entry = counts.get(member.id) ?? { total: 0, completed: 0 };
    return {
      id: member.id,
      name: member.name,
      role: member.role,
      totalChores: entry.total,
      completedChores: entry.completed,
      completionRate: entry.total
        ? Math.round((entry.completed / entry.total) * 100)
        : 0,
    };
  });
  const participationById = new Map(
    participation.map((member) => [member.id, member]),
  );
  const totalChores = allChores.length;
  const completedChores = allChores.filter((chore) =>
    DONE.has(chore.status),
  ).length;
  const dayCounts: Record<string, number> = {};
  const monthAgo = new Date(now.getTime() - 30 * 86400000);
  for (const chore of completed.results) {
    const at = dateValue(chore.completed_at);
    if (at && at >= monthAgo) {
      const day = weekdayOfKey(dayKey(at));
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    }
  }
  const mostActive = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];
  let currentStreak = 0;
  let cursor = completedByDay.has(today) ? today : addDaysToKey(today, -1);
  while (completedByDay.has(cursor)) {
    currentStreak += 1;
    cursor = addDaysToKey(cursor, -1);
  }
  const weekStart = addDaysToKey(today, -6);
  const dueThisWeek = allChores.filter((chore) => {
    const date = dateValue(chore.due_date);
    if (!date) return false;
    const key = date.toISOString().slice(0, 10);
    return key >= weekStart && key <= today;
  });
  const gamification = isFeatureEnabled(
    normalizeFeatures(family?.features ? familyJson(family.features) : null),
    "gamification",
  );
  const membersBody = members.results
    .map((member) => {
      const item = participationById.get(member.id);
      const base = {
        id: member.id,
        name: member.name,
        role: member.role,
        avatar_url: member.avatar_url,
        completedChores: item?.completedChores ?? 0,
        totalChores: item?.totalChores ?? 0,
      };
      return gamification
        ? {
            ...base,
            xp: member.xp,
            level: member.level,
            streak: member.streak,
            best_streak: member.best_streak,
          }
        : base;
    })
    .sort((a, b) =>
      gamification
        ? ((b as { xp?: number }).xp ?? 0) - ((a as { xp?: number }).xp ?? 0)
        : b.completedChores - a.completedChores,
    );
  const summary = {
    totalChores,
    completedChores,
    completionRate: totalChores
      ? Math.round((completedChores / totalChores) * 100)
      : 0,
    currentStreak,
    ...(!options.summaryOnly
      ? {
          mostActiveDay: mostActive
            ? { day: mostActive[0], count: mostActive[1] }
            : null,
        }
      : {}),
  };
  return {
    status: 200,
    body: {
      ...(options.summaryOnly ? { coverage: ANALYTICS_SUMMARY_COVERAGE } : {}),
      summary,
      weeklyTrend,
      weeklyCompletion: dueThisWeek.length
        ? Math.round(
            (dueThisWeek.filter((chore) => DONE.has(chore.status)).length /
              dueThisWeek.length) *
              100,
          )
        : 0,
      gamification,
      members: membersBody,
      ...(!options.summaryOnly
        ? {
            memberParticipation: participation,
            topPerformers: [...participation]
              .sort((a, b) => b.completedChores - a.completedChores)
              .slice(0, 3),
            difficultyDistribution: {
              easy: allChores.filter((chore) => chore.difficulty === "easy")
                .length,
              medium: allChores.filter((chore) => chore.difficulty === "medium")
                .length,
              hard: allChores.filter((chore) => chore.difficulty === "hard")
                .length,
            },
            recentActivity: activities.results.map((activity) => ({
              id: activity.id,
              type: activity.type,
              title: activity.title,
              description: activity.description,
              createdAt: new Date(activity.created_at),
              userName: activity.user_name ?? "",
            })),
          }
        : {}),
    },
  };
}
