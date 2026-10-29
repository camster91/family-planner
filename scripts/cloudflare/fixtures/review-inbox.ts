import type { D1Store } from "../../../src/lib/cloudflare/database";
import {
  readD1ChangeTimeline,
  readD1ReviewInbox,
} from "../../../src/lib/cloudflare/review-inbox";
import { TimelineAccessError } from "../../../src/lib/review-inbox/timeline";
import { scheduleEventToken } from "../../../src/lib/calendar-planning/schedule-source";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const features = JSON.stringify({
  chores: true,
  calendar: true,
  lists: true,
  family: true,
  meals: true,
  notes: true,
});
const parent = {
  userId: "review-native-parent",
  familyId: "review-native-family-a",
  role: "parent",
  tokenVersion: 0,
} as const;
const child = {
  userId: "review-native-child",
  familyId: "review-native-family-a",
  role: "child",
  tokenVersion: 0,
} as const;

/** Disposable native coverage for parent inbox/timeline authority and privacy. */
export async function testReviewInbox(db: D1Store) {
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  await db.batch([
    db
      .prepare(
        `INSERT INTO "Family"(id,name,invite_code,features) VALUES
          ('review-native-family-a','Review A','review-native-code-a',?1),
          ('review-native-family-b','Review B','review-native-code-b',?1)`,
      )
      .bind(features),
    db.prepare(`INSERT INTO "User"(id,email,name,role,family_id,token_version,email_verified) VALUES
      ('review-native-parent','review-native-parent@example.test','Review Parent','parent','review-native-family-a',0,1),
      ('review-native-child','review-native-child@example.test','Review Child','child','review-native-family-a',0,1),
      ('review-native-foreign','review-native-foreign@example.test','Foreign Parent','parent','review-native-family-b',0,1)`),
    db
      .prepare(
        `INSERT INTO "Event"(id,family_id,title,description,start_time,end_time,created_by) VALUES
          ('review-native-event-current','review-native-family-a','Current event','Current',?1,?1,'review-native-parent'),
          ('review-native-event-stale','review-native-family-a','Stale event','Needs review',?1,?1,'review-native-parent'),
          ('review-native-event-foreign','review-native-family-b','Foreign event',NULL,?1,?1,'review-native-foreign')`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO "Chore"(id,family_id,title,description,due_date,status,assigned_to,created_by,is_template) VALUES
          ('review-native-chore','review-native-family-a','Completed chore','Current check',?1,'completed','review-native-parent','review-native-parent',0),
          ('review-native-template','review-native-family-a','Template chore',NULL,?1,'completed','review-native-parent','review-native-parent',1),
          ('review-native-foreign-chore','review-native-family-b','Foreign chore',NULL,?1,'completed','review-native-foreign','review-native-foreign',0)`,
      )
      .bind(now),
    db.prepare(`INSERT INTO "Recipe"(id,family_id,title,created_by) VALUES
      ('review-native-recipe','review-native-family-a','Current recipe','review-native-parent')`),
    db
      .prepare(
        `INSERT INTO "Activity"(id,family_id,user_id,type,title,metadata,created_at) VALUES
          ('review-native-activity-event','review-native-family-a','review-native-parent','event_created','Household record changed',?1,?2),
          ('review-native-activity-chore','review-native-family-a','review-native-parent','chore_completed','Household record changed',?3,?2),
          ('review-native-activity-recipe','review-native-family-a','review-native-parent','recipe_created','Household record changed',?4,?2),
          ('review-native-activity-foreign','review-native-family-b','review-native-foreign','event_created','Household record changed',?5,?2)`,
      )
      .bind(
        JSON.stringify({
          timeline: 1,
          target: { kind: "event", id: "review-native-event-current" },
        }),
        now,
        JSON.stringify({
          timeline: 1,
          actorKind: "person",
          target: { kind: "chore", id: "review-native-chore" },
        }),
        JSON.stringify({
          timeline: 1,
          target: { kind: "recipe", id: "review-native-recipe" },
        }),
        JSON.stringify({
          timeline: 1,
          target: { kind: "event", id: "review-native-event-foreign" },
        }),
      ),
    db
      .prepare(
        `INSERT INTO "AuditLog"(id,family_id,actor_user_id,actor_kind,action,target_type,target_id,summary,created_at) VALUES
      ('review-native-audit','review-native-family-a','review-native-parent','person','feature.turned_on','feature','notes','Feature changed',?1),
      ('review-native-audit-foreign','review-native-family-b','review-native-foreign','person','feature.turned_on','feature','notes','Feature changed',?1)`,
      )
      .bind(now),
  ]);

  const events = await db
    .prepare(
      `SELECT id,schedule_generation AS generation,schedule_epoch AS epoch
      FROM "Event" WHERE family_id=?1 AND id IN (?2,?3)`,
    )
    .bind(
      parent.familyId,
      "review-native-event-current",
      "review-native-event-stale",
    )
    .all<{ id: string; generation: string; epoch: number }>();
  const current = events.results.find(
    (row) => row.id === "review-native-event-current",
  )!;
  const stale = events.results.find(
    (row) => row.id === "review-native-event-stale",
  )!;
  await db.batch([
    db
      .prepare(
        `INSERT INTO "EventPreparation"(id,family_id,event_id,reviewed_event_source) VALUES
          ('review-native-preparation-current',?1,?2,?3),
          ('review-native-preparation-stale',?1,?4,'old-source')`,
      )
      .bind(
        parent.familyId,
        current.id,
        scheduleEventToken(parent.familyId, current),
        stale.id,
      ),
  ]);

  const checks = await readD1ReviewInbox(parent, { source: "checks" }, db);
  check(
    checks.state === "available" &&
      checks.items.length === 1 &&
      checks.items[0].id === "review-native-chore",
    "completed chore inbox is scoped",
  );
  check(
    (await readD1ReviewInbox(child, { source: "checks" }, db)).state ===
      "forbidden",
    "child cannot read parent inbox",
  );
  const previousReady = process.env.FAMILY_EVENT_PREPARATION_READY;
  process.env.FAMILY_EVENT_PREPARATION_READY = "1";
  try {
    const preparation = await readD1ReviewInbox(
      parent,
      { source: "preparation" },
      db,
    );
    check(
      preparation.state === "available" &&
        preparation.items.length === 1 &&
        preparation.items[0].id === stale.id,
      "stale preparation remains reviewable",
    );
    check(
      (await readD1ReviewInbox(parent, { source: "saved" }, db)).state ===
        "available",
      "saved source renews parent authority",
    );
  } finally {
    if (previousReady === undefined)
      delete process.env.FAMILY_EVENT_PREPARATION_READY;
    else process.env.FAMILY_EVENT_PREPARATION_READY = previousReady;
  }

  const timeline = await readD1ChangeTimeline(
    parent,
    { source: "all" },
    new Date(now),
    db,
  );
  check(
    timeline.entries.length === 4,
    "timeline includes current household changes",
  );
  check(
    timeline.entries.some(
      (entry) =>
        entry.target?.kind === "event" &&
        entry.target.id === "review-native-event-current" &&
        entry.current === "available",
    ),
    "timeline resolves current event",
  );
  check(
    timeline.entries.some(
      (entry) =>
        entry.target?.kind === "recipe" && entry.current === "available",
    ),
    "timeline resolves current recipe",
  );
  check(
    timeline.entries.some((entry) => entry.target?.kind === "settings"),
    "timeline includes settings audit",
  );
  check(
    !JSON.stringify(timeline).includes("foreign"),
    "timeline stays in the household",
  );
  const settings = await readD1ChangeTimeline(
    parent,
    { source: "settings" },
    new Date(now),
    db,
  );
  check(
    settings.entries.length === 1 &&
      settings.entries[0].target?.kind === "settings",
    "settings stream excludes coordination activity",
  );
  await expectTimelineUnauthorized(db);
  return {
    inbox: true,
    preparation: true,
    timeline: true,
    settings: true,
    householdIsolation: true,
    parentOnly: true,
  };
}

async function expectTimelineUnauthorized(db: D1Store) {
  try {
    await readD1ChangeTimeline(
      { ...parent, tokenVersion: 1 },
      { source: "all" },
      new Date("2026-10-28T12:00:00.000Z"),
      db,
    );
    throw new Error("stale timeline actor was accepted");
  } catch (error) {
    check(
      error instanceof TimelineAccessError && error.status === 401,
      "stale timeline actor is refused",
    );
  }
}
