/** Native D1 morning-summary runner.
 *
 * The cron secret remains the route's operator boundary. This module owns the
 * D1 reads, once-per-local-day claim, in-app delivery and the existing opt-in
 * Mailgun transport. An injected mailer remains available for disposable
 * Worker fixtures; it never defaults to a network call in tests.
 */
import { addUTCDays, startOfTodayUTC, toDateOnlyUTC } from "@/lib/dates";
import { normalizeFeatures } from "@/lib/features";
import { dayKeyFor } from "@/lib/local-day-key";
import { morningSummaryEmail } from "@/lib/mail";
import { sendD1OptInMail as sendCanonicalD1OptInMail } from "@/lib/notification-delivery";
import {
  buildMorningSummary,
  type SummaryChore,
  type SummaryDinner,
  type SummaryEvent,
} from "@/lib/morning-summary";
import {
  isInQuietHours,
  isValidTimeZone,
  quietHoursFromRow,
} from "@/lib/quiet-hours";
import { logRouteError } from "@/lib/route-error-log";
import { deliverD1Notification } from "./notification-delivery";
import { getD1Database, type D1Store } from "./database";

export const D1_MORNING_SUMMARY_PAGE_SIZE = 200;
export const D1_MORNING_SUMMARY_MAX_SCANNED = 5000;
export const D1_MORNING_SUMMARY_MAX_ROWS_READ = 50000;
export const D1_MORNING_SUMMARY_MAX_SENDS = 1000;
const MAX_EVENTS = 100;
const MAX_CHORES = 300;
const MAX_DINNERS = 20;
const ROUTE = "POST /api/cron/morning-summary";

type Recipient = {
  id: string;
  name: string;
  role: string;
  token_version: number;
  family_id: string;
  morning_summary_time_zone: string | null;
  morning_summary_sent_on: string | null;
  morning_summary_enabled: number | boolean;
  email: string | null;
  email_verified: number | boolean;
  quiet_hours_enabled: number | boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_time_zone: string | null;
};

type Household = {
  features: { chores: boolean; calendar: boolean; meals: boolean };
  chores: SummaryChore[];
  events: SummaryEvent[];
  dinners: SummaryDinner[];
  toCheckCount: number;
};

export type D1MorningSummaryMailer = (input: {
  userId: string;
  familyId: string;
  to: string;
  message: ReturnType<typeof morningSummaryEmail>;
}) => Promise<{ sent: boolean }>;

export type D1MorningSummaryOptions = {
  now?: Date;
  fallbackTimeZone?: string | null;
  requestId?: string;
  appUrl?: string;
  limits?: {
    pageSize?: number;
    maxScanned?: number;
    maxRowsRead?: number;
  };
  /** Test/approved transport seam. Production defaults to the existing Mailgun fetch transport. */
  mailer?: D1MorningSummaryMailer;
};

export type D1MorningSummaryResult = {
  success: boolean;
  households: { processed: number; failed: number };
  sent: { inApp: number; email: number };
  skipped: {
    alreadySent: number;
    quietHours: number;
    nothingToday: number;
    noEmail: number;
  };
  failedRecipients: number;
  truncated: boolean;
};

function bool(value: unknown) {
  return value === true || value === 1;
}

function date(value: unknown) {
  const parsed = new Date(typeof value === "number" ? value : String(value));
  if (!Number.isFinite(parsed.getTime()))
    throw new Error("Invalid D1 summary date");
  return parsed;
}

function json(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function settingsFor(role: string, appUrl: string) {
  return role === "parent" || role === "teen"
    ? {
        settingsUrl: `${appUrl}/dashboard/settings`,
        settingsLabel: "Settings → Notifications",
      }
    : {
        settingsUrl: `${appUrl}/dashboard`,
        settingsLabel: "the menu under your name → Notifications",
      };
}

async function loadHousehold(
  store: D1Store,
  familyId: string,
  now: Date,
): Promise<Household> {
  const db = store.withSession("first-primary");
  const family = await db
    .prepare(`SELECT features FROM "Family" WHERE id=?1`)
    .bind(familyId)
    .first<{ features: string | null }>();
  const features = normalizeFeatures(json(family?.features));
  const enabled = {
    chores: features.chores,
    calendar: features.calendar,
    meals: features.meals,
  };
  const today = startOfTodayUTC(now);
  const from = addUTCDays(today, -2).getTime();
  const to = addUTCDays(today, 3).getTime();
  const chores = enabled.chores
    ? await db
        .prepare(
          `SELECT title,due_date,status,assigned_to FROM "Chore" WHERE family_id=?1 AND due_date>=?2 AND due_date<?3 ORDER BY due_date ASC,created_at ASC,id ASC LIMIT ${MAX_CHORES}`,
        )
        .bind(familyId, from, to)
        .all<{
          title: string;
          due_date: number;
          status: string;
          assigned_to: string | null;
        }>()
    : { results: [] };
  const events = enabled.calendar
    ? await db
        .prepare(
          `SELECT title,start_time,end_time FROM "Event" WHERE family_id=?1 AND end_time>=?2 AND start_time<?3 ORDER BY start_time ASC,id ASC LIMIT ${MAX_EVENTS}`,
        )
        .bind(familyId, from, to)
        .all<{ title: string; start_time: number; end_time: number }>()
    : { results: [] };
  const dinners = enabled.meals
    ? await db
        .prepare(
          `SELECT m.date,m.recipe_name,r.title AS recipe_title FROM "FamilyMeal" m LEFT JOIN "Recipe" r ON r.id=m.recipe_id AND r.family_id=m.family_id WHERE m.family_id=?1 AND m.meal_type='dinner' AND m.date>=?2 AND m.date<?3 ORDER BY m.date ASC,m.created_at ASC,m.id ASC LIMIT ${MAX_DINNERS}`,
        )
        .bind(familyId, from, to)
        .all<{
          date: number;
          recipe_name: string | null;
          recipe_title: string | null;
        }>()
    : { results: [] };
  const pending = enabled.chores
    ? await db
        .prepare(
          `SELECT COUNT(*) AS count FROM "Chore" WHERE family_id=?1 AND status='completed'`,
        )
        .bind(familyId)
        .first<{ count: number }>()
    : { count: 0 };
  return {
    features: enabled,
    chores: chores.results.flatMap((row) =>
      row.assigned_to === null
        ? []
        : [
            {
              title: row.title,
              dueDay: toDateOnlyUTC(date(row.due_date)),
              status: row.status,
              assigneeId: row.assigned_to,
            },
          ],
    ),
    events: events.results.map((row) => ({
      title: row.title,
      start: date(row.start_time),
      end: date(row.end_time),
    })),
    dinners: dinners.results.map((row) => ({
      day: toDateOnlyUTC(date(row.date)),
      name: row.recipe_name?.trim() || row.recipe_title?.trim() || null,
    })),
    toCheckCount: Number(pending?.count ?? 0),
  };
}

async function claimDay(store: D1Store, user: Recipient, dayKey: string) {
  const session = store.withSession("first-primary");
  const result = await session.batch([
    session
      .prepare(
        `UPDATE "User" SET morning_summary_sent_on=?1 WHERE id=?2 AND family_id=?3 AND role=?4 AND token_version=?5 AND morning_summary_enabled=1 AND (morning_summary_sent_on IS NULL OR morning_summary_sent_on<>?1) RETURNING id`,
      )
      .bind(dayKey, user.id, user.family_id, user.role, user.token_version),
  ]);
  return result[0]?.results?.length === 1;
}

type CurrentMailRecipient = {
  family_id: string | null;
  role: string;
  token_version: number;
  email: string | null;
  email_verified: number | boolean;
  morning_summary_enabled: number | boolean;
  quiet_hours_enabled: number | boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_time_zone: string | null;
};

type D1MailResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | "membership_changed"
        | "opted_out"
        | "unverified"
        | "quiet_hours"
        | "mail_not_configured";
    };

/**
 * Revalidate the recipient immediately before outbound mail, matching the
 * canonical sendOptInMail policy. D1 cannot hold an interactive SQL lock over
 * a remote fetch, so the daily claim is the dedupe boundary and this primary
 * read is the final membership/preference/quiet-hours check before sending.
 */
async function sendD1OptInMail(
  store: D1Store,
  user: Recipient,
  message: ReturnType<typeof morningSummaryEmail>,
  mailer: D1MorningSummaryMailer | undefined,
  now: Date,
): Promise<D1MailResult> {
  const current = await store
    .withSession("first-primary")
    .prepare(
      `SELECT family_id,role,token_version,email,email_verified,morning_summary_enabled,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,quiet_hours_time_zone FROM "User" WHERE id=?1`,
    )
    .bind(user.id)
    .first<CurrentMailRecipient>();

  if (
    !current ||
    current.family_id !== user.family_id ||
    current.role !== user.role ||
    current.token_version !== user.token_version
  ) {
    return { sent: false, reason: "membership_changed" };
  }
  if (!bool(current.morning_summary_enabled)) {
    return { sent: false, reason: "opted_out" };
  }
  if (!bool(current.email_verified) || !current.email) {
    return { sent: false, reason: "unverified" };
  }
  if (
    isInQuietHours(
      now,
      quietHoursFromRow({
        ...current,
        quiet_hours_enabled: bool(current.quiet_hours_enabled),
      }),
    )
  ) {
    return { sent: false, reason: "quiet_hours" };
  }

  // The injected seam is deliberately checked after the same recipient
  // authorization reads. Fixtures can therefore exercise privacy and race
  // behavior without setting provider secrets or contacting Mailgun.
  if (mailer) {
    const result = await mailer({
      userId: user.id,
      familyId: user.family_id,
      to: current.email,
      message,
    });
    return result.sent
      ? { sent: true }
      : { sent: false, reason: "mail_not_configured" };
  }
  // The canonical delivery helper owns the configured Mailgun transport and
  // its bounded timeout. Keep this call after the same preflight checks above
  // so injected fixtures and production share the membership boundary.
  return sendCanonicalD1OptInMail(
    store,
    {
      userId: user.id,
      familyId: user.family_id,
      recipientContext: {
        role: user.role,
        tokenVersion: user.token_version,
      },
      subject: message.subject,
      html: message.html,
      text: message.text,
    },
    now,
  );
}

/** Run the same opt-in summary policy against native D1. */
export async function runD1MorningSummary(
  options: D1MorningSummaryOptions = {},
  database?: D1Store,
): Promise<D1MorningSummaryResult> {
  const store = database ?? (await getD1Database());
  const now = options.now ?? new Date();
  const fallbackTimeZone = isValidTimeZone(options.fallbackTimeZone)
    ? options.fallbackTimeZone
    : "UTC";
  const appUrl = (
    options.appUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://family.ashbi.ca"
  ).replace(/\/+$/, "");
  const result: D1MorningSummaryResult = {
    success: true,
    households: { processed: 0, failed: 0 },
    sent: { inApp: 0, email: 0 },
    skipped: { alreadySent: 0, quietHours: 0, nothingToday: 0, noEmail: 0 },
    failedRecipients: 0,
    truncated: false,
  };
  const pageSize = options.limits?.pageSize ?? D1_MORNING_SUMMARY_PAGE_SIZE;
  const maxScanned =
    options.limits?.maxScanned ?? D1_MORNING_SUMMARY_MAX_SCANNED;
  const maxRowsRead =
    options.limits?.maxRowsRead ?? D1_MORNING_SUMMARY_MAX_ROWS_READ;
  let cursor: string | null = null;
  let scanned = 0;
  let rowsRead = 0;
  let sends = 0;
  const households = new Map<string, Household>();

  pages: while (rowsRead < maxRowsRead) {
    const params: Array<string | number | null> = [
      Math.min(pageSize, maxRowsRead - rowsRead),
    ];
    let cursorSql = "";
    if (cursor) {
      params.push(cursor);
      cursorSql = " AND id>?2";
    }
    const statement = store
      .withSession("first-primary")
      .prepare(
        `SELECT id,name,role,token_version,family_id,morning_summary_time_zone,morning_summary_sent_on,morning_summary_enabled,email,email_verified,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,quiet_hours_time_zone FROM "User" WHERE morning_summary_enabled=1 AND family_id IS NOT NULL${cursorSql} ORDER BY id ASC LIMIT ?1`,
      )
      .bind(...params);
    const page = await statement.all<Recipient>();
    if (!page.results.length) break;
    rowsRead += page.results.length;
    cursor = page.results.at(-1)!.id;
    const due = new Map<
      string,
      Array<{ user: Recipient; dayKey: string; timeZone: string }>
    >();
    for (const user of page.results) {
      const timeZone = isValidTimeZone(user.morning_summary_time_zone)
        ? user.morning_summary_time_zone!
        : fallbackTimeZone;
      const dayKey = dayKeyFor({ kind: "tz", timeZone })(now);
      if (user.morning_summary_sent_on === dayKey) {
        result.skipped.alreadySent++;
        continue;
      }
      if (
        isInQuietHours(
          now,
          quietHoursFromRow({
            ...user,
            quiet_hours_enabled: bool(user.quiet_hours_enabled),
          }),
        )
      ) {
        result.skipped.quietHours++;
        continue;
      }
      if (scanned >= maxScanned) {
        result.truncated = true;
        break;
      }
      scanned++;
      const members = due.get(user.family_id) ?? [];
      members.push({ user, dayKey, timeZone });
      due.set(user.family_id, members);
    }
    for (const [familyId, members] of due) {
      if (sends >= D1_MORNING_SUMMARY_MAX_SENDS) {
        result.truncated = true;
        break pages;
      }
      let household = households.get(familyId);
      try {
        if (!household) {
          household = await loadHousehold(store, familyId, now);
          households.set(familyId, household);
        }
        result.households.processed++;
      } catch (error) {
        result.households.failed++;
        logRouteError(`${ROUTE} (household)`, error, options.requestId);
        continue;
      }
      for (const { user, dayKey, timeZone } of members) {
        if (sends >= D1_MORNING_SUMMARY_MAX_SENDS) {
          result.truncated = true;
          break pages;
        }
        const summary = buildMorningSummary({
          person: { id: user.id, role: user.role },
          dayKey,
          timeZone,
          ...household,
        });
        if (!summary) {
          result.skipped.nothingToday++;
          continue;
        }
        try {
          if (!(await claimDay(store, user, dayKey))) {
            result.skipped.alreadySent++;
            continue;
          }
          sends++;
          const inApp = await deliverD1Notification(
            {
              userId: user.id,
              familyId,
              recipientContext: {
                role: user.role,
                tokenVersion: user.token_version,
              },
              type: "summary",
              title: "Your morning summary",
              message: summary.text,
              actionUrl: "/dashboard/today",
            },
            now,
            store,
          );
          if (inApp.delivered) result.sent.inApp++;
          const mailed = await sendD1OptInMail(
            store,
            user,
            morningSummaryEmail({
              name: user.name,
              dayLabel: summary.dayLabel,
              lines: summary.lines,
              todayUrl: `${appUrl}/dashboard/today`,
              ...settingsFor(user.role, appUrl),
            }),
            options.mailer,
            now,
          );
          if (mailed.sent) result.sent.email++;
          else result.skipped.noEmail++;
        } catch (error) {
          result.failedRecipients++;
          logRouteError(`${ROUTE} (recipient)`, error, options.requestId);
        }
      }
    }
    if (result.truncated || page.results.length < pageSize) break;
  }
  if (rowsRead >= maxRowsRead) result.truncated = true;
  result.success =
    result.households.failed === 0 && result.failedRecipients === 0;
  return result;
}
