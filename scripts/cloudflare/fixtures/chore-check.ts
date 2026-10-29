import { checkD1Chore } from "../../../src/lib/cloudflare/chore-check";
import type { D1Store } from "../../../src/lib/cloudflare/database";
import {
  choreCheckSnapshot,
  CHORE_CHECK_COMMAND_PROTOCOL,
  type ChoreCheckCommand,
} from "../../../src/lib/chore-check-command-shared";
import { HouseholdMemberIdentityConflict } from "../../../src/lib/household-member-lifecycle";
function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
export async function testChoreCheck(db: D1Store) {
  const fixed = new Date("2026-10-28T16:00:00Z"),
    day = Date.parse("2026-10-28T00:00:00Z");
  await db
    .prepare(
      `INSERT INTO "Family"(id,name,invite_code,features) VALUES ('check-a','Fixture','check-a','{"chores":true,"gamification":true}'),('check-b','Other','check-b','{"chores":true}')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO "User"(id,email,name,family_id,role) VALUES ('check-parent','check-parent@example.test','Parent','check-a','parent'),('check-teen','check-teen@example.test','Teen','check-a','teen'),('check-sibling','check-sibling@example.test','Sibling','check-a','child'),('check-other','check-other@example.test','Other','check-b','parent')`,
    )
    .run();
  const actor = {
      userId: "check-parent",
      familyId: "check-a",
      role: "parent",
      generation: 0,
    },
    options = { database: db, now: fixed };
  const seed = async (
    id: string,
    status = "completed",
    profile: string | null = null,
  ) =>
    db
      .prepare(
        `INSERT INTO "Chore"(id,family_id,title,points,assigned_to,assigned_member_id,created_by,due_date,status,completed_at,photo_url) VALUES (?1,'check-a',?1,10,?2,?3,'check-parent',?4,?5,?6,'/uploads/old-photo.jpg')`,
      )
      .bind(
        id,
        profile ? null : "check-teen",
        profile,
        day,
        status,
        status === "completed" ? fixed.getTime() : null,
      )
      .run();
  const chore = (id: string) =>
    db
      .prepare(`SELECT * FROM "Chore" WHERE id=?1`)
      .bind(id)
      .first<{
        status: string;
        preparation_epoch: number;
        responsibility_generation: string;
        responsibility_epoch: number;
        photo_verified: number;
        verified_notes: string | null;
        completed_at: number | null;
        assigned_to: string | null;
        assigned_member_id: string | null;
        successor_id: string | null;
      }>();
  const stats = () =>
    db
      .prepare(
        `SELECT xp,level,streak,best_streak FROM "User" WHERE id='check-teen'`,
      )
      .first<{
        xp: number;
        level: number;
        streak: number;
        best_streak: number;
      }>();
  const activities = () =>
    db
      .prepare(`SELECT count(*) AS n FROM "Activity" WHERE family_id='check-a'`)
      .first<{ n: number }>();
  await seed("check-race");
  const first = await Promise.all(
    Array.from({ length: 8 }, () =>
      checkD1Chore(
        actor,
        { choreId: "check-race", decision: "approve" },
        options,
      ),
    ),
  );
  check(
    first.every((r) => r.status === 200) &&
      first.filter((r) => r.effect).length === 1,
    "eight approvals converge on one effect",
  );
  check(
    (await stats())?.xp === 15 &&
      (await stats())?.streak === 1 &&
      (await activities())?.n === 1,
    "one XP award/streak/activity",
  );
  check(
    (await chore("check-race"))?.status === "verified" &&
      (await chore("check-race"))?.photo_verified === 1 &&
      (await chore("check-race"))?.preparation_epoch === 1,
    "verified proof epoch",
  );
  check(
    (
      await checkD1Chore(
        actor,
        { choreId: "check-race", decision: "reject" },
        options,
      )
    ).status === 409,
    "verified send back refused",
  );
  await seed("check-concurrent-a");
  await seed("check-concurrent-b");
  const both = await Promise.all(
    ["check-concurrent-a", "check-concurrent-b"].map((choreId) =>
      checkD1Chore(actor, { choreId, decision: "approve" }, options),
    ),
  );
  check(
    both.every((r) => r.status === 200) &&
      (await stats())?.xp === 49 &&
      (await stats())?.streak === 1,
    "different chores serialize derived XP on same day",
  );
  await db
    .prepare(
      `UPDATE "User" SET xp=90,level=1,streak=0,last_chore_date=NULL WHERE id='check-teen'`,
    )
    .run();
  await seed("check-level");
  const level = await checkD1Chore(
    actor,
    { choreId: "check-level", decision: "approve" },
    options,
  );
  check(
    level.effect?.xp?.levelUp &&
      level.effect.xp.newLevel === 2 &&
      (await stats())?.xp === 105,
    "same-transaction level result",
  );
  await seed("check-reject");
  await seed("check-successor", "pending");
  await db
    .prepare(
      `UPDATE "Chore" SET successor_id='check-successor' WHERE id='check-reject'`,
    )
    .run();
  const beforeRejectXp = (await stats())!.xp;
  const rejected = await checkD1Chore(
    actor,
    {
      choreId: "check-reject",
      decision: "reject",
      verificationNotes: "Please finish the corners",
    },
    options,
  );
  check(
    rejected.status === 200 &&
      !!rejected.effect &&
      (await chore("check-reject"))?.status === "pending" &&
      (await chore("check-reject"))?.verified_notes ===
        "Please finish the corners" &&
      (await chore("check-reject"))?.completed_at === null &&
      !(await chore("check-successor")) &&
      (await stats())?.xp === beforeRejectXp,
    "send-back note/proof/successor atomic without XP",
  );
  check(
    !(
      await checkD1Chore(
        actor,
        { choreId: "check-reject", decision: "reject" },
        options,
      )
    ).effect,
    "repeat send-back no-op",
  );
  check(
    (
      await checkD1Chore(
        actor,
        { choreId: "check-reject", decision: "approve" },
        options,
      )
    ).status === 400,
    "never completed approval400",
  );
  await db
    .prepare(
      `INSERT INTO "Chore"(id,family_id,title,assigned_to,created_by,due_date) VALUES ('check-foreign','check-b','Foreign','check-other','check-other',?1)`,
    )
    .bind(day)
    .run();
  check(
    (
      await checkD1Chore(
        actor,
        { choreId: "check-foreign", decision: "approve" },
        options,
      )
    ).status === 403,
    "foreign household403",
  );
  check(
    (
      await checkD1Chore(
        { ...actor, userId: "check-teen", role: "teen" },
        { choreId: "check-level", decision: "approve" },
        options,
      )
    ).status === 403,
    "teen cannot verify",
  );
  const racing = (sql: string, delayMs = 0): D1Store => ({
    prepare: db.prepare.bind(db),
    batch: db.batch.bind(db),
    withSession() {
      const session = db.withSession("first-primary");
      let fired = false;
      return {
        prepare: session.prepare.bind(session),
        async batch(statements) {
          if (!fired) {
            fired = true;
            if (sql) await db.prepare(sql).run();
            if (delayMs)
              await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          return session.batch(statements);
        },
      };
    },
  });
  await seed("check-revoke");
  check(
    (
      await checkD1Chore(
        actor,
        { choreId: "check-revoke", decision: "approve" },
        {
          ...options,
          database: racing(
            `UPDATE "User" SET token_version=1 WHERE id='check-parent'`,
          ),
        },
      )
    ).status === 401 && (await chore("check-revoke"))?.status === "completed",
    "actor revocation at commit rolls back",
  );
  await db
    .prepare(`UPDATE "User" SET token_version=0 WHERE id='check-parent'`)
    .run();
  await seed("check-feature");
  check(
    (
      await checkD1Chore(
        actor,
        { choreId: "check-feature", decision: "approve" },
        {
          ...options,
          database: racing(
            `UPDATE "Family" SET features='{"chores":false}' WHERE id='check-a'`,
          ),
        },
      )
    ).status === 403 && (await chore("check-feature"))?.status === "completed",
    "feature-off at commit rolls back",
  );
  await db
    .prepare(
      `UPDATE "Family" SET features='{"chores":true,"gamification":true}' WHERE id='check-a'`,
    )
    .run();
  await seed("check-rollback");
  const rollbackXp = (await stats())!.xp,
    rollbackFacts = (await activities())!.n;
  await db
    .prepare(
      `CREATE TRIGGER check_fail_activity BEFORE INSERT ON "Activity" WHEN NEW.type='chore_verified' BEGIN SELECT RAISE(ABORT,'forced check failure'); END`,
    )
    .run();
  let failed = false;
  try {
    await checkD1Chore(
      actor,
      { choreId: "check-rollback", decision: "approve" },
      options,
    );
  } catch {
    failed = true;
  } finally {
    await db.prepare(`DROP TRIGGER check_fail_activity`).run();
  }
  check(
    failed &&
      (await chore("check-rollback"))?.status === "completed" &&
      (await chore("check-rollback"))?.preparation_epoch === 0 &&
      (await stats())?.xp === rollbackXp &&
      (await activities())?.n === rollbackFacts,
    "activity failure rolls back status epoch and XP",
  );
  await db
    .prepare(
      `INSERT INTO "HouseholdMember"(id,family_id,name,role,age) VALUES ('check-profile','check-a','Young child','child',3),('check-archived','check-a','Archived','child',3)`,
    )
    .run();
  await seed("check-profile-approve", "completed", "check-profile");
  await seed("check-profile-reject", "completed", "check-profile");
  await seed("check-profile-archive", "completed", "check-archived");
  const profileXp = (await stats())!.xp;
  check(
    (
      await checkD1Chore(
        actor,
        { choreId: "check-profile-approve", decision: "approve" },
        options,
      )
    ).effect?.profile === true && (await stats())?.xp === profileXp,
    "email-free profile verified without account XP",
  );
  check(
    (
      await checkD1Chore(
        actor,
        {
          choreId: "check-profile-reject",
          decision: "reject",
          verificationNotes: "Try again",
        },
        options,
      )
    ).effect?.profile === true &&
      (await chore("check-profile-reject"))?.verified_notes === "Try again",
    "email-free profile send-back",
  );
  await db
    .prepare(
      `UPDATE "HouseholdMember" SET archived_at=?1 WHERE id='check-archived'`,
    )
    .bind(fixed.getTime())
    .run();
  check(
    (
      await checkD1Chore(
        actor,
        { choreId: "check-profile-archive", decision: "approve" },
        options,
      )
    ).status === 409,
    "archived profile verification held",
  );
  await db
    .prepare(
      `INSERT INTO "HouseholdMember"(id,family_id,name,role,age) VALUES ('check-canonical','check-a','Mapped','teen',15)`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO "HouseholdMemberLegacyMapping"(member_id,user_id,family_id) VALUES ('check-canonical','check-teen','check-a')`,
    )
    .run();
  await seed("check-canonical-archive");
  await db
    .prepare(
      `UPDATE "Chore" SET assigned_member_id='check-canonical' WHERE id='check-canonical-archive'`,
    )
    .run();
  await db
    .prepare(
      `UPDATE "HouseholdMember" SET archived_at=?1 WHERE id='check-canonical'`,
    )
    .bind(fixed.getTime())
    .run();
  const beforeArchived = (await stats())!.xp;
  check(
    (
      await checkD1Chore(
        actor,
        { choreId: "check-canonical-archive", decision: "approve" },
        options,
      )
    ).status === 200 && (await stats())?.xp === beforeArchived,
    "inactive canonical account keeps history without new XP",
  );
  await db
    .prepare(
      `UPDATE "HouseholdMember" SET archived_at=NULL WHERE id='check-canonical'`,
    )
    .run();
  await seed("check-departed");
  await db
    .prepare(
      `UPDATE "Chore" SET assigned_to='check-other' WHERE id='check-departed'`,
    )
    .run();
  check(
    (
      await checkD1Chore(
        actor,
        { choreId: "check-departed", decision: "reject" },
        options,
      )
    ).status === 200 &&
      (await chore("check-departed"))?.assigned_to === "check-parent",
    "departed legacy task handed to parent",
  );
  // Private cohort gates are local fixture state only, restored before return.
  const keys = [
    "CHORE_CHECK_COMMANDS_ENABLED",
    "CHORE_CHECK_NOTIFICATION_EVENTS_ENABLED",
    "CHORE_CHECK_NOTIFICATION_DISPATCH_MS",
    "NOTIFICATION_EVENT_ADMISSION_ENABLED",
  ];
  const previous = keys.map((key) => process.env[key]);
  try {
    process.env.CHORE_CHECK_COMMANDS_ENABLED = "1";
    const owned = async (id: string): Promise<ChoreCheckCommand> => {
      const row = await chore(id);
      const expected = choreCheckSnapshot(row!);
      check(expected, "review snapshot");
      return {
        protocol: CHORE_CHECK_COMMAND_PROTOCOL,
        owner: { ...actor, role: "parent" },
        choreId: id,
        expected,
        decision: "approve",
      };
    };
    await seed("check-owned");
    const command = await owned("check-owned");
    const ownedRace = await Promise.all(
      Array.from({ length: 8 }, () =>
        checkD1Chore(actor, { ...command, original: command }, options),
      ),
    );
    check(
      ownedRace.filter((r) => r.status === 200).length === 1 &&
        ownedRace.filter((r) => r.status === 409).length === 7,
      "owned review applies exactly original completion",
    );
    await seed("check-aba");
    const aba = await owned("check-aba");
    await db
      .prepare(`UPDATE "Chore" SET status='pending' WHERE id='check-aba'`)
      .run();
    await db
      .prepare(`UPDATE "Chore" SET status='completed' WHERE id='check-aba'`)
      .run();
    check(
      (await checkD1Chore(actor, { ...aba, original: aba }, options)).status ===
        409 && (await chore("check-aba"))?.status === "completed",
      "completion ABA refuses reviewed command",
    );
    await seed("check-material");
    const material = await owned("check-material");
    check(
      (
        await checkD1Chore(
          actor,
          { ...material, original: material },
          {
            ...options,
            database: racing(
              `UPDATE "Chore" SET title='Changed' WHERE id='check-material'`,
            ),
          },
        )
      ).status === 409,
      "material edit at commit invalidates review",
    );
    process.env.NOTIFICATION_EVENT_ADMISSION_ENABLED = "1";
    process.env.CHORE_CHECK_NOTIFICATION_EVENTS_ENABLED = "1";
    process.env.CHORE_CHECK_NOTIFICATION_DISPATCH_MS = "60000";
    await seed("check-cohort");
    await db
      .prepare(
        `UPDATE "User" SET xp=90,level=1,streak=0,last_chore_date=NULL WHERE id='check-teen'`,
      )
      .run();
    const cohort = await checkD1Chore(
      actor,
      { choreId: "check-cohort", decision: "approve" },
      { database: db },
    );
    check(
      cohort.status === 200 &&
        cohort.effect?.notifiedInTx &&
        cohort.effect.xp?.levelUp,
      "cohort verification commits canonical XP result",
    );
    const decisions = await db
      .prepare(
        `SELECT d.status,d.quiet,n.message,n.action_url FROM "NotificationRecipientDecision" d LEFT JOIN "Notification" n ON n.id=d.notification_id WHERE d.family_id='check-a'`,
      )
      .all<{
        status: string;
        quiet: number;
        message: string;
        action_url: string;
      }>();
    check(
      decisions.results.length === 1 &&
        decisions.results[0].status === "created" &&
        decisions.results[0].message.includes("Level 2") &&
        decisions.results[0].action_url.includes("check-cohort"),
      "one accepted occurrence/recipient notice with actual level result",
    );
    check(
      !(
        await checkD1Chore(
          actor,
          { choreId: "check-cohort", decision: "approve" },
          { database: db },
        )
      ).effect,
      "cohort repeat creates no new occurrence",
    );
    await seed("check-cohort-muted");
    await db
      .prepare(`UPDATE "User" SET notify_chores=0 WHERE id='check-teen'`)
      .run();
    check(
      (
        await checkD1Chore(
          actor,
          { choreId: "check-cohort-muted", decision: "reject" },
          { database: db },
        )
      ).effect?.notifiedInTx,
      "cohort muted send-back commits",
    );
    check(
      (await db
        .prepare(
          `SELECT count(*) AS n FROM "NotificationRecipientDecision" WHERE family_id='check-a' AND status='suppressed' AND notification_id IS NULL AND quiet=1`,
        )
        .first<{ n: number }>())!.n === 1,
      "suppressed recipient slot terminal without inbox row",
    );
    await db
      .prepare(`UPDATE "User" SET notify_chores=1 WHERE id='check-teen'`)
      .run();
    await seed("check-cohort-rollback");
    const cohortXp = (await stats())!.xp,
      cohortFacts = (await activities())!.n;
    await db
      .prepare(
        `CREATE TRIGGER check_fail_recipient BEFORE INSERT ON "NotificationRecipientDecision" BEGIN SELECT RAISE(ABORT,'forced recipient failure'); END`,
      )
      .run();
    failed = false;
    try {
      await checkD1Chore(
        actor,
        { choreId: "check-cohort-rollback", decision: "approve" },
        { database: db },
      );
    } catch {
      failed = true;
    } finally {
      await db.prepare(`DROP TRIGGER check_fail_recipient`).run();
    }
    check(
      failed &&
        (await chore("check-cohort-rollback"))?.status === "completed" &&
        (await stats())?.xp === cohortXp &&
        (await activities())?.n === cohortFacts &&
        (await db
          .prepare(
            `SELECT count(*) AS n FROM "NotificationEventOccurrence" WHERE family_id='check-a'`,
          )
          .first<{ n: number }>())!.n === 2,
      "recipient failure rolls back status XP activity occurrence and notice",
    );
    await seed("check-cohort-reassign");
    check(
      (
        await checkD1Chore(
          actor,
          { choreId: "check-cohort-reassign", decision: "approve" },
          {
            database: racing(
              `UPDATE "Chore" SET assigned_to='check-sibling' WHERE id='check-cohort-reassign'`,
            ),
          },
        )
      ).status === 409,
      "cohort assignment race held before award",
    );
    await seed("check-cohort-expired");
    process.env.CHORE_CHECK_NOTIFICATION_DISPATCH_MS = "2000";
    failed = false;
    try {
      await checkD1Chore(
        actor,
        { choreId: "check-cohort-expired", decision: "approve" },
        { database: racing("", 2100) },
      );
    } catch {
      failed = true;
    }
    check(
      failed && (await chore("check-cohort-expired"))?.status === "completed",
      "deadline expiry rolls back canonical check",
    );
  } finally {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
  }
  // Ensure a contradictory canonical member cannot be silently credited.
  await seed("check-conflict");
  await db
    .prepare(
      `INSERT INTO "HouseholdMember"(id,family_id,name,role,age) VALUES ('check-wrong','check-a','Wrong','teen',15)`,
    )
    .run();
  // A live mismatch is rejected by either the storage identity guard or reader.
  let conflict = false;
  try {
    await db
      .prepare(
        `UPDATE "Chore" SET assigned_member_id='check-wrong' WHERE id='check-conflict'`,
      )
      .run();
    await checkD1Chore(
      actor,
      { choreId: "check-conflict", decision: "approve" },
      options,
    );
  } catch (error) {
    conflict =
      error instanceof HouseholdMemberIdentityConflict ||
      (error instanceof Error && error.message.includes("Chore subject requires explicit account reconciliation"));
  }
  check(
    conflict && (await chore("check-conflict"))?.status === "completed",
    "contradictory canonical identity refused",
  );
  return {
    approveRace: 8,
    concurrentXp: true,
    oneActivityAndEpoch: true,
    levelResult: true,
    rejectNoteAndExactSuccessor: true,
    noXpOnReject: true,
    parentOnly: true,
    authorityAndFeatureRaces: true,
    atomicRollback: true,
    emailFreeProfiles: true,
    archivedNoReward: true,
    departedHandoff: true,
    ownedRace: 8,
    completionABA: true,
    materialReviewRace: true,
    canonicalRefusal: true,
    cohortDeliveryAndSuppression: true,
    cohortAtomicRollback: true,
    cohortAssignmentRace: true,
    deadlineRollback: true,
  };
}
