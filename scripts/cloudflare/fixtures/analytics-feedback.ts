import type { D1Store } from "../../../src/lib/cloudflare/database";
import { pruneD1LegacyAnalytics } from "../../../src/lib/cloudflare/legacy-analytics";
import { readD1Analytics } from "../../../src/lib/cloudflare/analytics";
import {
  readD1Feedback,
  saveD1Feedback,
} from "../../../src/lib/cloudflare/feedback";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const parent = {
  userId: "analytics-parent",
  familyId: "analytics-family-a",
  role: "parent",
  generation: 0,
} as const;
const child = {
  userId: "analytics-child",
  familyId: "analytics-family-a",
  role: "child",
  generation: 0,
} as const;
const foreign = {
  userId: "analytics-foreign",
  familyId: "analytics-family-b",
  role: "parent",
  generation: 0,
} as const;

/** Fabricated analytics and feedback coverage; no providers or browser data. */
export async function testAnalyticsFeedback(db: D1Store) {
  const now = Date.parse("2026-10-28T16:00:00.000Z");
  const features = JSON.stringify({ analytics: true, gamification: true });
  await db.batch([
    db
      .prepare(
        `INSERT INTO Family(id,name,invite_code,features) VALUES
          ('analytics-family-a','Analytics A','analytics-code-a',?1),
          ('analytics-family-b','Analytics B','analytics-code-b',?2)`,
      )
      .bind(features, JSON.stringify({ analytics: true, gamification: false })),
    db.prepare(
      `INSERT INTO User(id,email,name,role,family_id,token_version,xp,level,streak,best_streak) VALUES
        ('analytics-parent','analytics-parent@example.test','Analytics Parent','parent','analytics-family-a',0,40,2,3,5),
        ('analytics-child','analytics-child@example.test','Analytics Child','child','analytics-family-a',0,20,1,1,2),
        ('analytics-foreign','analytics-foreign@example.test','Other Parent','parent','analytics-family-b',0,900,9,9,9)`,
    ),
    db
      .prepare(
        `INSERT INTO Chore(id,family_id,title,points,assigned_to,due_date,status,difficulty,completed_at,created_by) VALUES
        ('analytics-done','analytics-family-a','Done',10,'analytics-child',?1,'completed','easy',?1,'analytics-parent'),
        ('analytics-open','analytics-family-a','Open',5,'analytics-child',?2,'pending','hard',NULL,'analytics-parent'),
        ('analytics-foreign-chore','analytics-family-b','Foreign',90,'analytics-foreign',?1,'completed','hard',?1,'analytics-foreign')`,
      )
      .bind(now - 86400000, now),
    db
      .prepare(
        `INSERT INTO Activity(id,family_id,user_id,type,title,description,created_at) VALUES
        ('analytics-activity','analytics-family-a','analytics-parent','chore_completed','Completed','Visible',?1),
        ('analytics-private','analytics-family-a','analytics-parent','chore_created','Private','Hidden',?1),
        ('analytics-foreign-activity','analytics-family-b','analytics-foreign','chore_completed','Foreign','Hidden',?1)`,
      )
      .bind(now),
  ]);

  const full = await readD1Analytics(
    parent,
    { zone: { kind: "utc" }, summaryOnly: false, now: new Date(now) },
    db,
  );
  const fullBody = full.body as any;
  check(full.status === 200, "analytics full status");
  check(fullBody.summary.totalChores === 2, "analytics household scope");
  check(fullBody.summary.completedChores === 1, "analytics completion summary");
  check(fullBody.members.length === 2, "analytics members scope");
  check(
    fullBody.recentActivity.length === 1 &&
      fullBody.recentActivity[0].id === "analytics-activity",
    "analytics private activity filter",
  );
  check(
    fullBody.members.every((member: any) => member.xp !== undefined),
    "analytics gamification projection",
  );

  const compact = await readD1Analytics(
    parent,
    { zone: { kind: "utc" }, summaryOnly: true, now: new Date(now) },
    db,
  );
  check(
    compact.status === 200 &&
      (compact.body as any).coverage.kind === "complete",
    "analytics compact coverage",
  );
  check(
    (compact.body as any).recentActivity === undefined,
    "analytics compact omits activity",
  );

  const saved = await saveD1Feedback(
    parent,
    {
      requestId: "4d6e1f35-8e84-4f6f-8d4d-54b4d6e8a1c1",
      kind: "bug",
      title: "Calendar",
      details: "The calendar needs a clearer empty state.",
      page: "/dashboard/calendar",
    },
    false,
    db,
  );
  check(
    saved.status === 201 &&
      (saved.body as any).report.family_id === parent.familyId,
    "feedback save",
  );
  const replay = await saveD1Feedback(
    parent,
    {
      requestId: "4d6e1f35-8e84-4f6f-8d4d-54b4d6e8a1c1",
      kind: "bug",
      title: "Calendar",
      details: "The calendar needs a clearer empty state.",
      page: "/dashboard/calendar",
    },
    true,
    db,
  );
  check(
    replay.status === 201 && (replay.body as any).report.details === undefined,
    "feedback summary replay projection",
  );
  const conflict = await saveD1Feedback(
    parent,
    {
      requestId: "4d6e1f35-8e84-4f6f-8d4d-54b4d6e8a1c1",
      kind: "feature",
      title: "Calendar",
      details: "A changed draft must not overwrite the report.",
      page: "/dashboard/calendar",
    },
    false,
    db,
  );
  check(
    conflict.status === 409 &&
      (conflict.body as any).code === "REPORT_REQUEST_CONFLICT",
    "feedback request conflict",
  );
  const reports = await readD1Feedback(parent, true, db);
  check(
    reports.status === 200 && (reports.body as any).reports.length === 1,
    "feedback private list",
  );
  const stale = await readD1Feedback({ ...parent, generation: 1 }, true, db);
  check(stale.status === 401, "feedback session generation");
  const foreignReports = await readD1Feedback(foreign, true, db);
  check(
    foreignReports.status === 200 &&
      (foreignReports.body as any).reports.length === 0,
    "feedback household isolation",
  );
  check(child.familyId === parent.familyId, "fixture child household");

  const expired = Date.now() - 100 * 86400000;
  await db.prepare(`INSERT INTO "Activity"(id,family_id,user_id,type,title,created_at) VALUES
    ('legacy-own-old','analytics-family-a','analytics-parent','event_page_view','Legacy',?1),
    ('legacy-foreign-old','analytics-family-b','analytics-foreign','event_page_view','Private legacy',?1),
    ('legacy-domain-event','analytics-family-a','analytics-parent','event_created','Real event',?1),
    ('legacy-import-event','analytics-family-a','analytics-parent','events_imported','Real import',?1),
    ('legacy-uppercase','analytics-family-a','analytics-parent','EVENT_page_view','Case boundary',?1)`)
    .bind(expired).run();
  check(await pruneD1LegacyAnalytics({ ...parent, generation: 1 }, new Date(), db) === 0, 'stale analytics request cannot prune');
  check(await pruneD1LegacyAnalytics(parent, new Date(), db) === 1, 'only literal own legacy prefix pruned');
  const retained = await db.prepare(`SELECT id FROM "Activity" WHERE id IN ('legacy-foreign-old','legacy-domain-event','legacy-import-event','legacy-uppercase')`).all();
  check(retained.results.length === 4, 'domain activity and foreign legacy retained');

  return {
    analytics: true,
    compact: true,
    activityPrivacy: true,
    feedback: true,
    feedbackConflict: true,
    householdIsolation: true,
    legacyRetention: true,
  };
}
