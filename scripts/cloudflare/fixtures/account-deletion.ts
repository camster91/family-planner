import type { D1Store } from "../../../src/lib/cloudflare/database";
import {
  deleteD1Household,
  deleteD1MemberAccount,
  readD1DeletionOptions,
  removeD1HouseholdMember,
} from "../../../src/lib/cloudflare/account-deletion";
import { topUpD1HouseholdSeries } from "../../../src/lib/cloudflare/recurring-chores";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const features = JSON.stringify({
  chores: true,
  calendar: true,
  lists: true,
  family: true,
  meals: true,
  messages: true,
});
const at = Date.parse("2026-10-28T12:00:00.000Z");
const historyAttachmentName = `${"d".repeat(32)}.jpg`;

/** Fabricated destructive-flow coverage. The runner uses a disposable D1
 * database and object/provider callbacks, so this never deletes real data or
 * contacts a provider. Register `testAccountDeletion` in read-worker.ts. */
export async function testAccountDeletion(db: D1Store) {
  // Model an edge interruption after the identity batch commits but before its
  // additive routine expansion. The successor foreground visit below turns
  // the rollout back on and exercises the durable retry path.
  process.env.ROUTINE_SCHEDULE_ENABLED = "0";
  process.env.ROUTINE_SCHEDULE_ROLLBACK_READY = "0";
  process.env.FAIR_CHORE_TOP_UP_ENABLED = "0";
  process.env.FAIR_CHORE_TOP_UP_ROLLBACK_READY = "0";
  const removedKeys: string[] = [];
  const removeObject = async (key: string) => {
    removedKeys.push(key);
  };
  const routineConfig = {
    protocol: "herewoven.routine-step-series.v1",
    revision: 1,
    once_pending: false,
    anchor_retired: false,
    stack_id: "deletion-native-stack",
    state: "active",
    effective_on: "2026-10-27",
    anchor: null,
    schedule: {
      frequency: "weekly",
      starts_on: "2026-10-27",
      weekly_days: [2],
      monthly_day: null,
    },
    content: {
      title: "Routine handover",
      description: null,
      subject: {
        kind: "account",
        user_id: "deletion-native-other-parent",
        member_id: null,
      },
      points: 5,
      difficulty: "easy",
      icon: null,
      duration_minutes: null,
    },
  };
  const routineSchedule = {
    protocol: "herewoven.routine-schedule.v1",
    state: "active",
    effective_on: "2026-10-27",
    anchor: null,
    schedule: {
      frequency: "weekly",
      starts_on: "2026-10-27",
      weekly_days: [2],
      monthly_day: null,
    },
    steps: [{ template_id: "deletion-native-routine-root" }],
  };
  const historyRoutineConfig = {
    ...routineConfig,
    stack_id: "deletion-native-history-stack",
    content: {
      ...routineConfig.content,
      subject: {
        kind: "account",
        user_id: "deletion-native-former",
        member_id: null,
      },
    },
  };
  const seedStatements = [
    db
      .prepare(
        `INSERT INTO "Family"(id,name,invite_code,features) VALUES
      ('deletion-native-family-a','Deletion A','deletion-native-code-a',?1),
      ('deletion-native-family-b','Deletion B','deletion-native-code-b',?1),
      ('deletion-native-family-history','Deletion History','deletion-native-code-history',?1)`,
      )
      .bind(features),
    db
      .prepare(
        `INSERT INTO "User"(id,email,password,name,role,family_id,email_verified,token_version,created_at) VALUES
      ('deletion-native-parent','deletion-parent@example.test','hash','Delete Parent','parent','deletion-native-family-a',1,0,?1),
      ('deletion-native-other-parent','deletion-other-parent@example.test','hash','Other Parent','parent','deletion-native-family-a',1,0,?1),
      ('deletion-native-child','deletion-child@example.test','hash','Delete Child','child','deletion-native-family-a',1,0,?1),
      ('deletion-native-last-parent','deletion-last-parent@example.test','hash','Last Parent','parent','deletion-native-family-b',1,0,?1),
      ('deletion-native-history-parent','deletion-history-parent@example.test','hash','History Parent','parent','deletion-native-family-history',1,0,?1),
      ('deletion-native-former','deletion-former@example.test','hash','Former Account','parent','deletion-native-family-history',1,0,?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "HouseholdMember"(id,family_id,name,role,created_at,updated_at) VALUES
      ('deletion-native-profile','deletion-native-family-a','Delete Child','child',?1,?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "HouseholdMemberAccountLink"(member_id,user_id,family_id,verified_at,created_at) VALUES
      ('deletion-native-profile','deletion-native-child','deletion-native-family-a',?1,?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "HouseholdDevice"(id,family_id,label,platform,created_by,confirmed_by,elevation_token_hash,elevated_user_id,elevated_token_version,elevation_method,elevation_started_at,elevation_last_used_at,elevation_expires_at,created_at,updated_at) VALUES
      ('deletion-native-child-device','deletion-native-family-a','Child tablet','android','deletion-native-child','deletion-native-child','deletion-native-elevation-hash','deletion-native-child',1,'pin',?1,?1,?2,?1,?1)`,
      )
      .bind(at, at + 86400000),
    db
      .prepare(
        `INSERT INTO "DeviceSession"(id,device_id,family_id,access_token_hash,access_expires_at,refresh_token_hash,refresh_expires_at,created_at) VALUES
      ('deletion-native-child-session','deletion-native-child-device','deletion-native-family-a','deletion-native-access-hash',?1,'deletion-native-refresh-hash',?2,?3)`,
      )
      .bind(at + 3600000, at + 86400000, at),
    db
      .prepare(
        `INSERT INTO "Chore"(id,family_id,title,due_date,status,assigned_to,created_by) VALUES
      ('deletion-native-chore','deletion-native-family-a','Child chore',?1,'pending','deletion-native-child','deletion-native-other-parent')`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "List"(id,family_id,name,type,created_by,created_at,updated_at) VALUES
      ('deletion-native-list','deletion-native-family-a','Shared list','grocery','deletion-native-other-parent',?1,?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "ListItem"(id,list_id,content,added_by,checked_by,created_at,updated_at) VALUES
      ('deletion-native-list-item','deletion-native-list','Shared item','deletion-native-parent','deletion-native-other-parent',?1,?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "Project"(id,family_id,name,created_by,created_at,updated_at) VALUES
      ('deletion-native-project','deletion-native-family-a','Shared project','deletion-native-other-parent',?1,?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "ProjectTask"(id,project_id,title,assigned_to,created_at,updated_at) VALUES
      ('deletion-native-project-task','deletion-native-project','Shared task','deletion-native-other-parent',?1,?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "Message"(id,family_id,sender_id,content,created_at) VALUES
      ('deletion-native-message','deletion-native-family-a','deletion-native-other-parent','Private message',?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "MessageAttachment"(id,family_id,uploaded_by,message_id,filename,content_type,size_bytes,created_at) VALUES
      ('deletion-native-attachment','deletion-native-family-a','deletion-native-other-parent','deletion-native-message','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg','image/jpeg',10,?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "Upload"(id,family_id,uploaded_by,filename,content_type,size_bytes,created_at) VALUES
      ('deletion-native-upload','deletion-native-family-a','deletion-native-parent','bbbbbbbbbbbbbbbb.jpg','image/jpeg',10,?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "CalendarConnection"(id,family_id,user_id,provider,access_token_enc,refresh_token_enc,created_at,updated_at) VALUES
      ('deletion-native-calendar','deletion-native-family-a','deletion-native-other-parent','google','access','refresh',?1,?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "RoutineStack"(id,family_id,label,version,fingerprint,created_by,schedule_config) VALUES
      ('deletion-native-stack','deletion-native-family-a','Morning routine',1,'fixture-fingerprint','deletion-native-other-parent',?1)`,
      )
      .bind(JSON.stringify(routineSchedule)),
    db
      .prepare(
        `INSERT INTO "Chore"(id,family_id,title,description,points,assigned_to,created_by,due_date,status,frequency,weekly_days,recurrence_id,is_template,routine_stack_id,routine_series_config) VALUES
      ('deletion-native-routine-root','deletion-native-family-a','Routine handover',NULL,5,'deletion-native-other-parent','deletion-native-other-parent',?1,'pending','weekly',?2,'deletion-native-routine-root',1,'deletion-native-stack',?3),
      ('deletion-native-routine-copy','deletion-native-family-a','Routine handover',NULL,5,'deletion-native-parent','deletion-native-other-parent',?4,'pending','weekly',?2,'deletion-native-routine-root',0,NULL,NULL)`,
      )
      .bind(
        at,
        JSON.stringify([2]),
        JSON.stringify(routineConfig),
        at + 86400000,
      ),
    db
      .prepare(
        `INSERT INTO "Chore"(id,family_id,title,due_date,status,assigned_to,created_by,photo_url) VALUES
      ('deletion-native-legacy-photo','deletion-native-family-a','Legacy chore photo',?1,'pending','deletion-native-parent','deletion-native-parent','/api/files/chores/cccccccccccccccc.jpg')`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "Chore"(id,family_id,title,due_date,status,assigned_to,created_by,recurrence_id,is_template,rotation_member_ids,rotation_index) VALUES
      ('deletion-native-rotation-root','deletion-native-family-a','Rotation root',?1,'pending','deletion-native-parent','deletion-native-parent','deletion-native-rotation-root',1,?2,0),
      ('deletion-native-rotation-copy','deletion-native-family-a','Rotation copy',?3,'pending','deletion-native-child','deletion-native-parent','deletion-native-rotation-root',0,?2,1)`,
      )
      .bind(
        at,
        JSON.stringify(["deletion-native-child", "deletion-native-parent"]),
        at + 86400000,
      ),
    db
      .prepare(
        `INSERT INTO "HouseholdMember"(id,family_id,name,role,archived_at,erasure_user_id,created_at,updated_at) VALUES
      ('deletion-native-history-profile','deletion-native-family-history','Former Account','parent',?1,'deletion-native-former',?1,?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "RoutineStack"(id,family_id,label,version,fingerprint,created_by,schedule_config) VALUES
      ('deletion-native-history-stack','deletion-native-family-history','Historical routine',1,'history-fingerprint','deletion-native-former',?1)`,
      )
      .bind(
        JSON.stringify({
          protocol: "herewoven.routine-schedule.v1",
          state: "active",
          effective_on: "2026-10-27",
          anchor: null,
          schedule: {
            frequency: "weekly",
            starts_on: "2026-10-27",
            weekly_days: [2],
            monthly_day: null,
          },
          steps: [{ template_id: "deletion-native-history-root" }],
        }),
      ),
    db
      .prepare(
        `INSERT INTO "Chore"(id,family_id,title,description,points,assigned_to,created_by,due_date,status,frequency,weekly_days,recurrence_id,is_template,routine_stack_id,routine_series_config,rotation_member_ids,rotation_index) VALUES
      ('deletion-native-history-root','deletion-native-family-history','Historical routine',NULL,5,'deletion-native-former','deletion-native-former',?1,'pending','weekly',?2,'deletion-native-history-root',1,'deletion-native-history-stack',?3,?4,0),
      ('deletion-native-history-copy','deletion-native-family-history','Historical routine',NULL,5,'deletion-native-history-parent','deletion-native-former',?5,'pending','weekly',?2,'deletion-native-history-root',0,NULL,NULL,?4,1)`,
      )
      .bind(
        at,
        JSON.stringify([2]),
        JSON.stringify(historyRoutineConfig),
        JSON.stringify([
          "deletion-native-former",
          "deletion-native-history-parent",
        ]),
        at + 86400000,
      ),
    db
      .prepare(
        `INSERT INTO "Chore"(id,family_id,title,due_date,status,assigned_to,created_by) VALUES
      ('deletion-native-history-personal','deletion-native-family-history','Imported personal chore',?1,'pending','deletion-native-former','deletion-native-former')`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "PinnedNote"(id,family_id,title,body,created_by,created_at,updated_at) VALUES
      ('deletion-native-history-note','deletion-native-family-history','History note','Keep this','deletion-native-former',?1,?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "ImportJob"(id,family_id,source_app,source_version,status,dry_run,started_by,started_at) VALUES
      ('deletion-native-history-import','deletion-native-family-history','fixture','1','completed',0,'deletion-native-history-parent',?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "ImportedRecord"(id,family_id,import_job_id,source_app,source_model,source_id,target_model,target_id,created_at) VALUES
      ('deletion-native-history-imported','deletion-native-family-history','deletion-native-history-import','fixture','task','source-history','Chore','deletion-native-history-personal',?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "Message"(id,family_id,sender_id,content,read_by,created_at) VALUES
      ('deletion-native-history-message','deletion-native-family-history','deletion-native-former','Former private message',?1,?2),
      ('deletion-native-history-surviving-message','deletion-native-family-history','deletion-native-history-parent','Surviving message',?3,?2)`,
      )
      .bind(
        JSON.stringify([
          "deletion-native-former",
          "deletion-native-history-parent",
        ]),
        at,
        JSON.stringify([
          "deletion-native-former",
          "deletion-native-history-parent",
        ]),
      ),
    db
      .prepare(
        `INSERT INTO "MessageAttachment"(id,family_id,uploaded_by,message_id,filename,content_type,size_bytes,created_at) VALUES
      ('deletion-native-history-attachment','deletion-native-family-history','deletion-native-former','deletion-native-history-message','${historyAttachmentName}','image/jpeg',10,?1)`,
      )
      .bind(at),
    db
      .prepare(
        `INSERT INTO "AuditLog"(id,family_id,actor_user_id,actor_kind,action,target_type,target_id,summary,created_at) VALUES
      ('deletion-native-history-audit-joined','deletion-native-family-history','deletion-native-former','person','member.joined','member','deletion-native-former','Former Account joined',?1),
      ('deletion-native-history-audit-removed','deletion-native-family-history','deletion-native-former','person','member.removed','member','deletion-native-former','Former Account removed',?1),
      ('deletion-native-history-audit-left','deletion-native-family-history','deletion-native-former','person','member.left','member','deletion-native-former','Former Account left',?1),
      ('deletion-native-history-audit-unknown','deletion-native-family-history','deletion-native-former','person','member.updated','member','deletion-native-former','Former Account updated',?1)`,
      )
      .bind(at),
    db
      .prepare(
        'UPDATE "User" SET family_id=NULL WHERE id=\'deletion-native-former\'',
      ),
  ];
  for (const [index, statement] of seedStatements.entries()) {
    try {
      await db.batch([statement]);
    } catch (error) {
      throw new Error(
        `seed[${index}]: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const options = await readD1DeletionOptions("deletion-native-parent", db);
  check(
    options?.household?.memberCount === 3 &&
      options.household.parentCount === 2,
    "deletion options are household scoped",
  );

  let otherParentRefused = false;
  try {
    await deleteD1Household(
      "deletion-native-family-a",
      "deletion-native-parent",
      {
        database: db,
        now: () => new Date(at),
        removeObject,
        revokeCalendarGrant: async () => {},
      },
    );
  } catch (error) {
    otherParentRefused =
      (error as { code?: string }).code === "OTHER_PARENTS_EXIST";
  }
  check(otherParentRefused, "a second parent blocks whole-household deletion");

  const removed = await removeD1HouseholdMember(
    {
      actorId: "deletion-native-parent",
      familyId: "deletion-native-family-a",
      targetId: "deletion-native-child",
    },
    {
      database: db,
      now: () => new Date(at),
      removeObject,
      revokeCalendarGrant: async () => {},
    },
  );
  check(
    removed.removedId === "deletion-native-child",
    "member removal returns the detached account",
  );
  const detached = await db
    .prepare('SELECT family_id FROM "User" WHERE id=?1')
    .bind("deletion-native-child")
    .first<{ family_id: string | null }>();
  const archived = await db
    .prepare(
      'SELECT archived_at,erasure_user_id FROM "HouseholdMember" WHERE id=?1',
    )
    .bind("deletion-native-profile")
    .first<{ archived_at: number | null; erasure_user_id: string | null }>();
  const reassigned = await db
    .prepare('SELECT assigned_to FROM "Chore" WHERE id=?1')
    .bind("deletion-native-chore")
    .first<{ assigned_to: string }>();
  const detachedDevice = await db
    .prepare(
      'SELECT revoked_at,elevation_token_hash,elevated_user_id FROM "HouseholdDevice" WHERE id=?1',
    )
    .bind("deletion-native-child-device")
    .first<{
      revoked_at: number | null;
      elevation_token_hash: string | null;
      elevated_user_id: string | null;
    }>();
  const detachedDeviceSession = await db
    .prepare('SELECT revoked_at FROM "DeviceSession" WHERE id=?1')
    .bind("deletion-native-child-session")
    .first<{ revoked_at: number | null }>();
  check(
    detached?.family_id === null &&
      archived?.archived_at === at &&
      archived.erasure_user_id === "deletion-native-child",
    "member removal revokes membership but keeps stable profile",
  );
  check(
    reassigned?.assigned_to === "deletion-native-parent",
    "open chores move to the removing parent",
  );
  check(
    detachedDevice?.revoked_at === at &&
      detachedDevice.elevation_token_hash === null &&
      detachedDevice.elevated_user_id === null &&
      detachedDeviceSession?.revoked_at === at,
    "member removal revokes device sessions and clears departed elevation credentials",
  );
  const rotationAfterDetach = await db
    .prepare('SELECT rotation_member_ids FROM "Chore" WHERE id=?1')
    .bind("deletion-native-rotation-root")
    .first<{ rotation_member_ids: string }>();
  const rotationOccurrenceAfterDetach = await db
    .prepare('SELECT rotation_index FROM "Chore" WHERE id=?1')
    .bind("deletion-native-rotation-copy")
    .first<{ rotation_index: number | null }>();
  check(
    rotationAfterDetach?.rotation_member_ids ===
      JSON.stringify(["deletion-native-parent"]) &&
      rotationOccurrenceAfterDetach?.rotation_index === 0,
    "member removal drops the account from rotation ids and repairs occurrence indexes",
  );

  const removedAccount = await deleteD1MemberAccount(
    "deletion-native-other-parent",
    {
      database: db,
      now: () => new Date(at),
      removeObject,
      revokeCalendarGrant: async () => {},
    },
  );
  check(
    removedAccount.successorId === "deletion-native-parent",
    "account deletion hands content to the earliest remaining parent",
  );
  check(
    (await db
      .prepare('SELECT id FROM "User" WHERE id=?1')
      .bind("deletion-native-other-parent")
      .first()) === null,
    "account is erased",
  );
  check(
    (
      await db
        .prepare('SELECT created_by FROM "Chore" WHERE id=?1')
        .bind("deletion-native-chore")
        .first<{ created_by: string }>()
    )?.created_by === "deletion-native-parent",
    "created content is handed over",
  );
  const handedReferences = await db
    .prepare(
      `SELECT l.created_by AS list_creator,li.checked_by AS list_checker,p.created_by AS project_creator,pt.assigned_to AS task_assignee
       FROM "List" l
       JOIN "ListItem" li ON li.list_id=l.id
       JOIN "Project" p ON p.id=?1
       JOIN "ProjectTask" pt ON pt.project_id=p.id
       WHERE l.id=?2 AND li.id=?3`,
    )
    .bind(
      "deletion-native-project",
      "deletion-native-list",
      "deletion-native-list-item",
    )
    .first<{
      list_creator: string;
      list_checker: string | null;
      project_creator: string;
      task_assignee: string | null;
    }>();
  check(
    handedReferences?.list_creator === "deletion-native-parent" &&
      handedReferences.list_checker === null &&
      handedReferences.project_creator === "deletion-native-parent" &&
      handedReferences.task_assignee === null,
    "nested list and project references stay household-scoped after handover",
  );
  const handedRoutine = await db
    .prepare(
      `SELECT id,created_by,assigned_to,member_subject_erased,routine_series_config FROM "Chore" WHERE family_id=?1 AND recurrence_id=id AND id<>?2 AND title='Routine handover' AND assigned_to IS NULL AND member_subject_erased=1 ORDER BY id DESC LIMIT 1`,
    )
    .bind(
      "deletion-native-family-a",
      "deletion-native-routine-root",
    )
    .first<{
      id: string;
      created_by: string;
      assigned_to: string | null;
      member_subject_erased: number;
      routine_series_config: string;
    }>();
  check(
    handedRoutine?.created_by === "deletion-native-parent" &&
      handedRoutine.assigned_to === null &&
      handedRoutine.member_subject_erased === 1,
    "routine control root is handed to successor without a personal assignee",
  );
  check(
    JSON.parse(handedRoutine.routine_series_config).anchor_retired === true &&
      JSON.parse(handedRoutine.routine_series_config).content.subject.kind ===
        "erased",
    "routine control root erases the departing subject",
  );
  check(
    (
      await db
        .prepare('SELECT recurrence_id FROM "Chore" WHERE id=?1')
        .bind("deletion-native-routine-copy")
        .first<{ recurrence_id: string }>()
    )?.recurrence_id === handedRoutine.id,
    "future routine occurrences follow the new control root",
  );
  const beforeForegroundRecovery = await db
    .prepare(
      'SELECT count(*) AS count FROM "Chore" WHERE family_id=?1 AND recurrence_id=?2 AND id<>?2',
    )
    .bind("deletion-native-family-a", handedRoutine.id)
    .first<{ count: number }>();
  check(
    beforeForegroundRecovery?.count === 1,
    "interrupted expansion leaves the retained successor occurrence intact",
  );
  check(
    (
      await db
        .prepare('SELECT schedule_config FROM "RoutineStack" WHERE id=?1')
        .bind("deletion-native-stack")
        .first<{ schedule_config: string }>()
    )?.schedule_config.includes(handedRoutine.id),
    "routine stack points at the successor control root",
  );
  process.env.ROUTINE_SCHEDULE_ENABLED = "1";
  process.env.ROUTINE_SCHEDULE_ROLLBACK_READY = "1";
  const successorTopUp = await topUpD1HouseholdSeries(
    "deletion-native-family-a",
    new Date(at),
    db,
  );
  const afterForegroundRecovery = await db
    .prepare(
      'SELECT count(*) AS count FROM "Chore" WHERE family_id=?1 AND recurrence_id=?2 AND id<>?2',
    )
    .bind("deletion-native-family-a", handedRoutine.id)
    .first<{ count: number }>();
  check(
    successorTopUp > 0 &&
      (afterForegroundRecovery?.count ?? 0) >
        (beforeForegroundRecovery?.count ?? 0),
    "successor foreground top-up recovers the missing future routine occurrence",
  );
  const formerAccount = await deleteD1MemberAccount("deletion-native-former", {
    database: db,
    now: () => new Date(at),
    removeObject,
    revokeCalendarGrant: async () => {},
  });
  check(
    formerAccount.successorId === null,
    "detached historical account completes without a current-household successor",
  );
  const historicalNote = await db
    .prepare('SELECT created_by FROM "PinnedNote" WHERE id=?1')
    .bind("deletion-native-history-note")
    .first<{ created_by: string }>();
  const historicalRoutine = await db
    .prepare('SELECT id,created_by,assigned_to FROM "Chore" WHERE id=?1')
    .bind("deletion-native-history-root")
    .first<{ id: string; created_by: string; assigned_to: string | null }>();
  check(
    historicalNote?.created_by === "deletion-native-history-parent",
    "historical retained content is handed to its own household successor",
  );
  check(
    historicalRoutine === null,
    "historical personal routine root is removed after control handover",
  );
  const historicalControl = await db
    .prepare(
      'SELECT id FROM "Chore" WHERE family_id=?1 AND recurrence_id=id AND title=?2 AND assigned_to IS NULL AND member_subject_erased=1 ORDER BY id DESC LIMIT 1',
    )
    .bind("deletion-native-family-history", "Historical routine")
    .first<{ id: string }>();
  check(
    historicalControl?.id,
    "historical erased routine control is retained",
  );
  const historicalBeforeTopUp = await db
    .prepare(
      'SELECT count(*) AS count FROM "Chore" WHERE family_id=?1 AND recurrence_id=?2',
    )
    .bind("deletion-native-family-history", historicalControl.id)
    .first<{ count: number }>();
  await topUpD1HouseholdSeries(
    "deletion-native-family-history",
    new Date(at),
    db,
  );
  const historicalAfterTopUp = await db
    .prepare(
      'SELECT count(*) AS count FROM "Chore" WHERE family_id=?1 AND recurrence_id=?2',
    )
    .bind("deletion-native-family-history", historicalControl.id)
    .first<{ count: number }>();
  check(
    historicalAfterTopUp?.count === historicalBeforeTopUp?.count,
    "erased historical routine subject never receives foreground copies",
  );
  check(
    (await db
      .prepare('SELECT id FROM "Chore" WHERE id=?1')
      .bind("deletion-native-history-personal")
      .first()) === null,
    "historical personal chore is removed",
  );
  check(
    (await db
      .prepare('SELECT id FROM "ImportedRecord" WHERE id=?1')
      .bind("deletion-native-history-imported")
      .first()) === null,
    "historical personal import provenance is removed",
  );
  check(
    (await db
      .prepare('SELECT id FROM "HouseholdMember" WHERE id=?1')
      .bind("deletion-native-history-profile")
      .first()) === null,
    "historical archived profile is removed",
  );
  const survivingHistoryMessage = await db
    .prepare('SELECT read_by FROM "Message" WHERE id=?1')
    .bind("deletion-native-history-surviving-message")
    .first<{ read_by: string }>();
  check(
    (await db
      .prepare('SELECT id FROM "Message" WHERE id=?1')
      .bind("deletion-native-history-message")
      .first()) === null,
    "historical sent message is removed",
  );
  check(
    survivingHistoryMessage?.read_by.includes(
      "deletion-native-history-parent",
    ) &&
      !survivingHistoryMessage.read_by.includes("deletion-native-former"),
    "historical message read markers are redacted only for the departing account",
  );
  const redactedAudits = await db
    .prepare(
      `SELECT action,target_id,actor_user_id,summary FROM "AuditLog" WHERE family_id=?1 ORDER BY id`,
    )
    .bind("deletion-native-family-history")
    .all<{
      action: string;
      target_id: string | null;
      actor_user_id: string | null;
      summary: string;
    }>();
  check(
    redactedAudits.results.length === 4 &&
      redactedAudits.results.every(
        (row) =>
          row.target_id === null &&
          row.actor_user_id === null &&
          !row.summary.includes("Former Account"),
      ),
    "historical audit targets and actor identifiers are redacted",
  );
  check(
    removedKeys.includes(
      `families/deletion-native-family-history/messages/${historyAttachmentName}`,
    ),
    "former-family message attachment key is cleaned after commit",
  );

  let lastParentRefused = false;
  try {
    await deleteD1MemberAccount("deletion-native-last-parent", {
      database: db,
      now: () => new Date(at),
      removeObject,
      revokeCalendarGrant: async () => {},
    });
  } catch (error) {
    lastParentRefused = (error as { code?: string }).code === "LAST_PARENT";
  }
  check(lastParentRefused, "the only parent cannot delete only their account");

  // Force a foreign-key failure after the destructive statements. D1 batches
  // must roll back the entire household, including users and private rows.
  const failingSession = {
    prepare: db.prepare.bind(db),
    batch: async (statements: any[]) =>
      db.batch([
        ...statements,
        db.prepare(
          `INSERT INTO "User"(id,email,name,family_id) VALUES ('deletion-native-rollback-bad','rollback@example.test','Rollback bad','missing-family')`,
        ),
      ]),
  };
  const failingDatabase = {
    prepare: db.prepare.bind(db),
    batch: async (statements: any[]) =>
      db.batch([
        ...statements,
        db.prepare(
          `INSERT INTO "User"(id,email,name,family_id) VALUES ('deletion-native-rollback-bad','rollback@example.test','Rollback bad','missing-family')`,
        ),
      ]),
    withSession: () => failingSession,
  } as any;
  let rollbackObserved = false;
  try {
    await deleteD1Household(
      "deletion-native-family-b",
      "deletion-native-last-parent",
      {
        database: failingDatabase,
        now: () => new Date(at),
        removeObject,
        revokeCalendarGrant: async () => {},
      },
    );
  } catch {
    rollbackObserved = true;
  }
  check(rollbackObserved, "household deletion reports the forced FK failure");
  check(
    (await db
      .prepare('SELECT id FROM "Family" WHERE id=?1')
      .bind("deletion-native-family-b")
      .first()) !== null,
    "failed household deletion rolls back the family",
  );
  check(
    (await db
      .prepare('SELECT id FROM "User" WHERE id=?1')
      .bind("deletion-native-last-parent")
      .first()) !== null,
    "failed household deletion rolls back the member",
  );

  const deletedB = await deleteD1Household(
    "deletion-native-family-b",
    "deletion-native-last-parent",
    {
      database: db,
      now: () => new Date(at),
      removeObject,
      revokeCalendarGrant: async () => {},
    },
  );
  check(
    deletedB.membersRemoved === 1,
    "household remains deletable after rollback",
  );

  const household = await deleteD1Household(
    "deletion-native-family-a",
    "deletion-native-parent",
    {
      database: db,
      now: () => new Date(at),
      removeObject,
      revokeCalendarGrant: async () => {},
    },
  );
  check(
    household.membersRemoved === 1,
    "household deletion removes remaining member accounts",
  );
  check(
    (await db
      .prepare('SELECT id FROM "Family" WHERE id=?1')
      .bind("deletion-native-family-a")
      .first()) === null,
    "household row is removed",
  );
  check(
    removedKeys.includes(
      "families/deletion-native-family-a/chores/cccccccccccccccc.jpg",
    ),
    "legacy chore photo key is cleaned after household commit",
  );
  return {
    options: true,
    otherParent: true,
    memberRemoval: true,
    accountDeletion: true,
    householdDeletion: true,
    lastParent: true,
    rollback: true,
  };
}
