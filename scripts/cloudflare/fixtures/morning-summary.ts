import type { D1Store } from "../../../src/lib/cloudflare/database";
import { runD1MorningSummary } from "../../../src/lib/cloudflare/morning-summary";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Native morning-summary coverage with an injected, non-network mailer. */
export async function testMorningSummary(db: D1Store) {
  const now = new Date("2026-10-28T15:00:00.000Z");
  const today = Date.parse("2026-10-28T00:00:00.000Z");
  const features = JSON.stringify({
    chores: true,
    calendar: true,
    meals: true,
  });
  await db.batch([
    db
      .prepare(
        `INSERT INTO "Family"(id,name,invite_code,features) VALUES ('summary-family','Summary family','summary-code',?1)`,
      )
      .bind(features),
    db.prepare(
      `INSERT INTO "User"(id,email,name,role,family_id,email_verified,token_version,morning_summary_enabled,morning_summary_time_zone,quiet_hours_enabled) VALUES
        ('summary-parent','summary-parent@example.test','Summary Parent','parent','summary-family',1,0,1,'UTC',0),
        ('summary-child','summary-child@example.test','Summary Child','child','summary-family',1,0,1,'UTC',0),
        ('summary-off','summary-off@example.test','Opted Out','teen','summary-family',1,0,0,'UTC',0)`,
    ),
    db
      .prepare(
        `INSERT INTO "Chore"(id,family_id,title,created_by,assigned_to,due_date,status,frequency,recurrence_id,is_template) VALUES
        ('summary-parent-chore','summary-family','Pack lunches','summary-parent','summary-parent',?1,'pending','once',NULL,0),
        ('summary-child-chore','summary-family','Feed the cat','summary-parent','summary-child',?1,'pending','once',NULL,0),
        ('summary-check','summary-family','Needs check','summary-parent','summary-child',?1,'completed','once',NULL,0)`,
      )
      .bind(today),
    db
      .prepare(
        `INSERT INTO "Event"(id,family_id,title,start_time,end_time,created_by) VALUES ('summary-event','summary-family','Dentist',?1,?2,'summary-parent')`,
      )
      .bind(today + 3600000, today + 7200000),
    db
      .prepare(
        `INSERT INTO "FamilyMeal"(id,family_id,date,meal_type,recipe_name,created_by) VALUES ('summary-meal','summary-family',?1,'dinner','Tacos','summary-parent')`,
      )
      .bind(today),
  ]);

  const sentTo: string[] = [];
  const first = await runD1MorningSummary(
    {
      now,
      fallbackTimeZone: "UTC",
      appUrl: "https://fixture.example.test",
      mailer: async ({ userId }) => {
        sentTo.push(userId);
        return { sent: true };
      },
    },
    db,
  );
  check(first.success, "morning summary succeeds");
  check(
    first.sent.inApp === 2 && first.sent.email === 2,
    "morning summary deliveries",
  );
  check(
    first.skipped.noEmail === 0 && sentTo.length === 2,
    "mock email transport only",
  );
  check(
    (
      await db
        .prepare(
          `SELECT count(*) AS count FROM "Notification" WHERE user_id IN ('summary-parent','summary-child')`,
        )
        .first<{ count: number }>()
    )?.count === 2,
    "native summary inbox rows",
  );
  check(
    (
      await db
        .prepare(
          `SELECT count(*) AS count FROM "Notification" WHERE message LIKE '%Feed the cat%'`,
        )
        .first<{ count: number }>()
    )?.count === 1,
    "child receives own chore only",
  );

  const replay = await runD1MorningSummary(
    { now, fallbackTimeZone: "UTC" },
    db,
  );
  check(
    replay.sent.inApp === 0 && replay.skipped.alreadySent === 2,
    "daily claim prevents replay",
  );
  await db
    .prepare(
      `UPDATE "User" SET morning_summary_enabled=1,quiet_hours_enabled=1,quiet_hours_start='00:00',quiet_hours_end='23:59' WHERE id='summary-child'`,
    )
    .run();
  await db
    .prepare(
      `UPDATE "User" SET morning_summary_sent_on=NULL WHERE id='summary-child'`,
    )
    .run();
  const quiet = await runD1MorningSummary({ now, fallbackTimeZone: "UTC" }, db);
  check(
    quiet.sent.inApp === 0 && quiet.skipped.quietHours >= 1,
    "quiet hours defer claim",
  );
  check(
    (
      await db
        .prepare(
          `SELECT morning_summary_sent_on AS sent FROM "User" WHERE id='summary-child'`,
        )
        .first<{ sent: string | null }>()
    )?.sent === null,
    "quiet hours leave day unclaimed",
  );

  return {
    optInSummary: true,
    householdContent: true,
    ownChorePrivacy: true,
    dailyClaim: true,
    quietHours: true,
    mockMailer: true,
  };
}
