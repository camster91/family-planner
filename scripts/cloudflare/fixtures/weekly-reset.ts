import type { D1Store } from "../../../src/lib/cloudflare/database";
import {
  authorizeD1WeeklyReset,
  readD1WeeklyReset,
  readD1WeeklyResetSummary,
  reviewD1WeeklyResetRequest,
  writeD1WeeklyReset,
} from "../../../src/lib/cloudflare/weekly-reset";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const features = JSON.stringify({
  chores: true,
  calendar: true,
  lists: true,
  family: true,
  meals: true,
  inventory: true,
  pickups: true,
  handoff: true,
});

/** Disposable native weekly-review coverage. */
export async function testWeeklyReset(db: D1Store) {
  const previousReady = process.env.FAMILY_WEEKLY_RESET_READY;
  process.env.FAMILY_WEEKLY_RESET_READY = "1";
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  const actor = {
    userId: "weekly-reset-native-parent",
    familyId: "weekly-reset-native-family",
    role: "parent",
    tokenVersion: 0,
  } as const;
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES (?1,?2,?3,?4)`)
        .bind("weekly-reset-native-family", "Weekly reset", "weekly-reset-native-code", features),
      db
        .prepare(`INSERT INTO "User"(id,email,name,role,family_id,email_verified,token_version) VALUES (?1,?2,?3,'parent',?4,1,0)`)
        .bind("weekly-reset-native-parent", "weekly-reset-native@example.test", "Weekly Parent", actor.familyId),
      db
        .prepare(`INSERT INTO "Event"(id,family_id,title,start_time,end_time,created_by) VALUES (?1,?2,?3,?4,?5,?6)`)
        .bind("weekly-reset-native-event", actor.familyId, "School meeting", Date.parse("2026-10-27T15:00:00.000Z"), Date.parse("2026-10-27T16:00:00.000Z"), actor.userId),
      db
        .prepare(`INSERT INTO "Chore"(id,family_id,title,due_date,status,assigned_to,created_by) VALUES (?1,?2,?3,?4,'pending',?5,?5)`)
        .bind("weekly-reset-native-chore", actor.familyId, "Take bins out", Date.parse("2026-10-28T00:00:00.000Z"), actor.userId),
      db
        .prepare(`INSERT INTO "FamilyMeal"(id,family_id,date,meal_type,recipe_name,created_by) VALUES (?1,?2,?3,'dinner',?4,?5)`)
        .bind("weekly-reset-native-meal", actor.familyId, Date.parse("2026-10-29T00:00:00.000Z"), "Chili", actor.userId),
      db
        .prepare(`INSERT INTO "MealPrepSession"(id,family_id,prepared_on,prepared_at,next_prep_on,created_by) VALUES (?1,?2,?3,?4,?5,?6)`)
        .bind("weekly-reset-native-session", actor.familyId, Date.parse("2026-10-26T00:00:00.000Z"), now, Date.parse("2026-11-02T00:00:00.000Z"), actor.userId),
      db
        .prepare(`INSERT INTO "MealBatch"(id,family_id,prep_session_id,position,name,total_servings) VALUES (?1,?2,?3,0,?4,6)`)
        .bind("weekly-reset-native-batch", actor.familyId, "weekly-reset-native-session", "Chili batch"),
      db
        .prepare(`INSERT INTO "MealBatchConsumption"(id,family_id,batch_id,servings,created_by,consumed_at) VALUES (?1,?2,?3,2,?4,?5)`)
        .bind("weekly-reset-native-consumption", actor.familyId, "weekly-reset-native-batch", actor.userId, now),
      db
        .prepare(`INSERT INTO "List"(id,family_id,name,type,created_by) VALUES (?1,?2,'Groceries','grocery',?3)`)
        .bind("weekly-reset-native-list", actor.familyId, actor.userId),
      db
        .prepare(`INSERT INTO "ListItem"(id,list_id,content,quantity,added_by) VALUES (?1,?2,'Milk',2,?3)`)
        .bind("weekly-reset-native-item", "weekly-reset-native-list", actor.userId),
      db
        .prepare(`INSERT INTO "InventoryItem"(id,family_id,name,status,expires_on,added_by,created_at,updated_at) VALUES (?1,?2,'Yogurt','active',?3,?4,?5,?5)`)
        .bind("weekly-reset-native-inventory", actor.familyId, Date.parse("2026-10-30T00:00:00.000Z"), actor.userId, now),
    ]);

    await authorizeD1WeeklyReset(actor, db);
    const scope = { weekStart: "2026-10-26", timeZone: "America/Toronto" } as const;
    const initial = await readD1WeeklyReset(actor, scope, db);
    check(initial.revision === 0 && initial.started === false, "weekly reset starts uninitialized");
    const schedule = await readD1WeeklyResetSummary(actor, scope, "schedule", new Date(now), db);
    check(schedule.groups[0]?.rows[0]?.title === "School meeting", "schedule summary is household scoped");
    const prep = await readD1WeeklyResetSummary(actor, scope, "prep", new Date(now), db);
    check(prep.groups[0]?.rows[0]?.eaten === 2 && prep.groups[0]?.rows[0]?.remaining === 4, "prep summary tracks eaten and remaining");
    const groceries = await readD1WeeklyResetSummary(actor, scope, "groceries", new Date(now), db);
    check(groceries.groups[0]?.rows[0]?.title === "Milk", "grocery summary is open-only");
    const command = {
      protocol: "herewoven.weekly-reset.v1" as const,
      familyId: actor.familyId,
      userId: actor.userId,
      issuedAt: new Date(now).toISOString(),
      weekStart: scope.weekStart,
      timeZone: scope.timeZone,
      expectedRevision: 0,
      action: "start" as const,
    };
    const written = await writeD1WeeklyReset(actor, command, "weekly-reset-native-key", db, new Date(now));
    check(written.status === 200 && (written.body as any).receipt.revision === 1, "weekly reset progress receipt");
    const replay = await writeD1WeeklyReset(actor, command, "weekly-reset-native-key", db, new Date(now));
    check(replay.replayed === true, "weekly reset receipt replay");
    const review = await reviewD1WeeklyResetRequest(actor, {
      kind: "weekly-reset",
      key: "weekly-reset-native-key",
      body: JSON.stringify(command),
    }, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", true, new Date(now), db);
    check(review.state === "committed", "weekly reset recovery sees committed receipt");
    return { read: true, summaries: true, progress: true, replay: true, recovery: true };
  } finally {
    if (previousReady === undefined) delete process.env.FAMILY_WEEKLY_RESET_READY;
    else process.env.FAMILY_WEEKLY_RESET_READY = previousReady;
  }
}
