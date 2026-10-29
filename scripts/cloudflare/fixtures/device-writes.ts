import { prepareD1DeviceSession } from "../../../src/lib/cloudflare/device-sessions";
import type { DeviceActor } from "../../../src/lib/device-session";
import {
  runD1DeviceChore,
  runD1DeviceListAdd,
  runD1DeviceListCheck,
} from "../../../src/lib/cloudflare/device-writes";
import type { D1Store } from "../../../src/lib/cloudflare/database";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Fabricated native paired-device effects; does not use production tokens or data. */
export async function testDeviceWrites(db: D1Store) {
  const now = new Date("2026-10-28T16:00:00.000Z");
  process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = "1";
  process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = "1";
  await db.batch([
    db.prepare(
      `INSERT INTO Family(id,name,invite_code,features,device_writes_enabled)
         VALUES ('device-write-a','Device fixture','device-write-code','{"lists":true,"chores":true}',1),
                ('device-write-b','Foreign fixture','device-write-code-b','{}',1)`,
    ),
    db.prepare(
      `INSERT INTO User(id,email,name,role,family_id) VALUES
         ('device-write-parent','device-write-parent@example.test','Parent','parent','device-write-a'),
         ('device-write-child','device-write-child@example.test','Child','child','device-write-a'),
         ('device-write-foreign','device-write-foreign@example.test','Foreign','parent','device-write-b')`,
    ),
    db
      .prepare(
        `INSERT INTO HouseholdDevice(id,family_id,label,platform,paired_at,last_seen_at)
         VALUES ('device-write-tablet','device-write-a','Kitchen tablet','web',?1,?1),
                ('device-write-foreign-tablet','device-write-b','Foreign tablet','web',?1,?1)`,
      )
      .bind(now.getTime()),
    db.prepare(
      `INSERT INTO List(id,family_id,name,type,created_by) VALUES
         ('device-write-list','device-write-a','Groceries','grocery','device-write-parent'),
         ('device-write-foreign-list','device-write-b','Private','grocery','device-write-foreign')`,
    ),
    db.prepare(
      `INSERT INTO ListItem(id,list_id,content,quantity,added_by,position)
         VALUES ('device-write-item','device-write-list','Milk',1,'device-write-parent',1),
                ('device-write-foreign-item','device-write-foreign-list','Private',1,'device-write-foreign',1)`,
    ),
    db.prepare(
      `INSERT INTO HouseholdMember(id,family_id,name,role,age)
         VALUES ('device-write-profile','device-write-a','Young child','child',3)`,
    ),
    db
      .prepare(
        `INSERT INTO Chore(id,family_id,title,assigned_to,created_by,assigned_member_id,due_date,status,frequency)
         VALUES ('device-write-chore','device-write-a','Take out trash','device-write-child','device-write-parent',NULL,?1,'pending','once'),
                ('device-write-profile-chore','device-write-a','Brush teeth',NULL,'device-write-parent','device-write-profile',?1,'pending','once')`,
      )
      .bind(now.getTime()),
  ]);
  await db
    .prepare(
      `INSERT INTO Chore(id,family_id,title,assigned_to,created_by,due_date,status,frequency,weekly_days)
       VALUES ('device-write-weekly','device-write-a','Weekly bin','device-write-child','device-write-parent',?1,'pending','weekly','[3]')`,
    )
    .bind(now.getTime())
    .run();
  const issued = prepareD1DeviceSession(
    db,
    "device-write-tablet",
    "device-write-a",
    now,
  );
  await db.batch(issued.statements);
  const actor: DeviceActor = {
    kind: "device",
    deviceId: "device-write-tablet",
    familyId: "device-write-a",
    sessionId: issued.tokens.sessionId,
    label: "Kitchen tablet",
  };
  const add = await runD1DeviceListAdd(
    actor,
    {
      listId: "device-write-list",
      content: "Bread",
      memberId: "device-write-child",
    },
    "device-write-add",
    { database: db, now },
  );
  check(add.status === 201, "device grocery add");
  const addReplay = await runD1DeviceListAdd(
    actor,
    {
      listId: "device-write-list",
      content: "Bread",
      memberId: "device-write-child",
    },
    "device-write-add",
    { database: db, now },
  );
  check(addReplay.replayed === true, "device grocery add replay");
  const addCount = await db
    .prepare(
      `SELECT count(*) AS count FROM ListItem
       WHERE list_id='device-write-list' AND source_request_id=(SELECT id FROM IdempotencyRecord WHERE key='device-write-add')`,
    )
    .first<{ count: number }>();
  check(addCount?.count === 1, "device grocery add exactly once");
  const checkItem = await runD1DeviceListCheck(
    actor,
    {
      itemId: "device-write-item",
      checked: true,
      memberId: "device-write-child",
    },
    "device-write-check",
    { database: db, now },
  );
  check(checkItem.status === 200, "device grocery check");
  const checked = await db
    .prepare(
      `SELECT checked,checked_by FROM ListItem WHERE id='device-write-item'`,
    )
    .first<{ checked: number; checked_by: string }>();
  check(
    checked?.checked === 1 && checked.checked_by === "device-write-child",
    "device attribution",
  );
  const foreignMember = await runD1DeviceListCheck(
    actor,
    {
      itemId: "device-write-item",
      checked: false,
      memberId: "device-write-foreign",
    },
    "device-write-foreign-member",
    { database: db, now },
  );
  check(foreignMember.status === 400, "foreign member rejected");
  const uncheckAt = new Date(now.getTime() + 1_000);
  const uncheck = await runD1DeviceListCheck(
    actor,
    {
      itemId: "device-write-item",
      checked: false,
      memberId: "device-write-child",
    },
    "device-write-uncheck",
    { database: db, now: uncheckAt },
  );
  check(uncheck.status === 200, "device grocery untick");
  const unchecked = await db
    .prepare(
      `SELECT checked,checked_by,checked_at,updated_at FROM ListItem WHERE id='device-write-item'`,
    )
    .first<{ checked: number; checked_by: string | null; checked_at: number | null; updated_at: number }>();
  check(
    unchecked?.checked === 0 && unchecked.checked_by === null && unchecked.checked_at === null && unchecked.updated_at === uncheckAt.getTime(),
    "device untick clears attribution but keeps row version",
  );
  const uncheckReplay = await runD1DeviceListCheck(
    actor,
    {
      itemId: "device-write-item",
      checked: false,
      memberId: "device-write-child",
    },
    "device-write-uncheck",
    { database: db, now: new Date(uncheckAt.getTime() + 1_000) },
  );
  check(uncheckReplay.replayed === true, "device untick replay");
  const uncheckedAgain = await db
    .prepare(`SELECT checked,checked_by,checked_at,updated_at FROM ListItem WHERE id='device-write-item'`)
    .first<{ checked: number; checked_by: string | null; checked_at: number | null; updated_at: number }>();
  check(
    uncheckedAgain?.checked === 0 && uncheckedAgain.checked_by === null && uncheckedAgain.checked_at === null && uncheckedAgain.updated_at === uncheckAt.getTime(),
    "device untick replay preserves attribution and version",
  );
  const foreign = await runD1DeviceListCheck(
    actor,
    {
      itemId: "device-write-foreign-item",
      checked: true,
      memberId: "device-write-child",
    },
    "device-write-foreign",
    { database: db, now },
  );
  check(foreign.status === 404, "foreign item hidden");
  const complete = await runD1DeviceChore(
    actor,
    {
      kind: "complete",
      choreId: "device-write-chore",
      memberId: "device-write-child",
    },
    "device-write-chore-complete",
    { database: db, now },
  );
  check(complete.status === 200, "device chore complete");
  const undo = await runD1DeviceChore(
    actor,
    {
      kind: "undo",
      choreId: "device-write-chore",
      memberId: "device-write-child",
    },
    "device-write-chore-undo",
    { database: db, now: new Date(now.getTime() + 1000) },
  );
  check(undo.status === 200, "device chore undo");
  const recurring = await runD1DeviceChore(
    actor,
    {
      kind: "complete",
      choreId: "device-write-weekly",
      memberId: "device-write-child",
    },
    "device-write-weekly-complete",
    { database: db, now },
  );
  check(recurring.status === 200, "device recurring chore complete");
  const recurringRow = await db
    .prepare(`SELECT successor_id FROM Chore WHERE id='device-write-weekly'`)
    .first<{ successor_id: string | null }>();
  check(recurringRow?.successor_id !== null, "device recurring successor");
  const profile = await runD1DeviceChore(
    actor,
    {
      kind: "complete",
      choreId: "device-write-profile-chore",
      memberId: "device-write-profile",
      profile: true,
    },
    "device-write-profile-complete",
    { database: db, now },
  );
  check(profile.status === 200, "email-free profile complete");
  const profileReplay = await runD1DeviceChore(
    actor,
    {
      kind: "complete",
      choreId: "device-write-profile-chore",
      memberId: "device-write-profile",
      profile: true,
    },
    "device-write-profile-complete",
    { database: db, now },
  );
  check(profileReplay.replayed === true, "email-free profile replay");
  const profileRow = await db
    .prepare(
      `SELECT status,completed_at FROM Chore WHERE id='device-write-profile-chore'`,
    )
    .first<{ status: string; completed_at: number | null }>();
  check(
    profileRow?.status === "completed" &&
      profileRow.completed_at === now.getTime(),
    "profile completion state",
  );
  return {
    addReplay: true,
    attribution: true,
    foreignIsolation: true,
    foreignMemberRejected: true,
    choreUndo: true,
    recurringSuccessor: true,
    profileCommand: true,
    profileReplay: true,
  };
}
