import type { D1Store } from "../../../src/lib/cloudflare/database";
import {
  readD1ResponsibilityView,
  reviewD1ResponsibilityRequest,
  writeD1Responsibility,
} from "../../../src/lib/cloudflare/responsibility";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const features = JSON.stringify({
  chores: true,
  calendar: true,
  lists: true,
  family: true,
  meals: true,
  pickups: true,
  handoff: true,
});

/** Disposable native coverage for source-bound consent and assignment state. */
export async function testResponsibility(db: D1Store) {
  const profileFlags = [
    "HOUSEHOLD_PROFILE_CHORE_ENABLED",
    "HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY",
  ];
  const previousProfiles = profileFlags.map((key) => process.env[key]);
  profileFlags.forEach((key) => (process.env[key] = "1"));
  const previousReady = process.env.FAMILY_RESPONSIBILITY_READY;
  const previousOwner = process.env.QUEUE_OWNER_RECOVERY_ENABLED;
  const previousRollback = process.env.QUEUE_OWNER_RECOVERY_ROLLBACK_READY;
  process.env.FAMILY_RESPONSIBILITY_READY = "1";
  // Reading the view must not implicitly grant write authority.  The write
  // gate is enabled only below, after the read-only contract is asserted.
  process.env.QUEUE_OWNER_RECOVERY_ENABLED = "0";
  process.env.QUEUE_OWNER_RECOVERY_ROLLBACK_READY = "1";
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  const parent = {
    userId: "responsibility-native-parent",
    familyId: "responsibility-native-family",
    role: "parent",
    tokenVersion: 0,
  } as const;
  const child = {
    ...parent,
    userId: "responsibility-native-child",
    role: "child",
  } as const;
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO "Family"(id,name,invite_code,features) VALUES (?1,'Responsibility family',?2,?3)`,
        )
        .bind(parent.familyId, "responsibility-native-code", features),
      db
        .prepare(
          `INSERT INTO "User"(id,email,name,role,family_id,email_verified,token_version) VALUES
          (?1,'responsibility-parent@example.test','Responsibility Parent','parent',?3,1,0),
          (?2,'responsibility-child@example.test','Responsibility Child','child',?3,1,0)`,
        )
        .bind(parent.userId, child.userId, parent.familyId),
      db
        .prepare(
          `INSERT INTO "Chore"(id,family_id,title,status,assigned_to,created_by,due_date) VALUES (?1,?2,'Clean room','pending',?3,?4,?5)`,
        )
        .bind(
          "responsibility-native-chore",
          parent.familyId,
          child.userId,
          parent.userId,
          now,
        ),
    ]);

    // Put canonical participants beyond the first discovery page.
    for (let offset = 0; offset < 55; offset += 10) {
      await db.batch(
        Array.from({ length: Math.min(10, 55 - offset) }, (_, i) => {
          const n = offset + i;
          return db
            .prepare(
              `INSERT INTO User(id,email,name,role,family_id) VALUES (?,?,?,'parent',?)`,
            )
            .bind(
              `responsibility-many-${n}`,
              `responsibility-many-${n}@example.test`,
              `A fixture ${n}`,
              parent.familyId,
            );
        }),
      );
    }
    const initial = await readD1ResponsibilityView(
      parent,
      { kind: "chore", id: "responsibility-native-chore" },
      "",
      db,
    );
    check(
      initial.primary?.member.subject.kind === "account" &&
        initial.primary.member.subject.accountId === child.userId,
      "primary assignment is visible",
    );
    check(
      initial.revision === 0 && initial.sourceToken.length === 64,
      "source and revision are fresh",
    );
    check(!initial.writesEnabled, "owner proof is not enough for read writes");

    const command = {
      protocol: "herewoven.responsibility.v1" as const,
      userId: parent.userId,
      familyId: parent.familyId,
      target: { kind: "chore" as const, id: "responsibility-native-chore" },
      sourceToken: initial.sourceToken,
      expectedRevision: 0,
      issuedAt: new Date(now).toISOString(),
      action: "set-backup" as const,
      subject: { kind: "account" as const, accountId: parent.userId },
    };
    process.env.QUEUE_OWNER_RECOVERY_ENABLED = "0";
    let paused = false;
    try {
      await writeD1Responsibility(
        parent,
        command,
        "responsibility-native-paused",
        db,
        new Date(now),
      );
    } catch (error) {
      paused = (error as { code?: string }).code === "UNAVAILABLE";
    }
    check(paused, "paused responsibility write is refused");
    process.env.QUEUE_OWNER_RECOVERY_ENABLED = "1";

    const written = await writeD1Responsibility(
      parent,
      command,
      "responsibility-native-key-123",
      db,
      new Date(now),
    );
    check(written.status === 200, "responsibility assignment receipt");
    const replay = await writeD1Responsibility(
      parent,
      command,
      "responsibility-native-key-123",
      db,
      new Date(now),
    );
    check(replay.replayed === true, "responsibility receipt replay");
    const updated = await readD1ResponsibilityView(
      parent,
      command.target,
      "",
      db,
    );
    check(
      updated.backup?.member.subject.kind === "account" &&
        updated.backup.member.subject.accountId === parent.userId &&
        updated.revision === 1,
      "backup state is projected",
    );

    const review = await reviewD1ResponsibilityRequest(
      parent,
      {
        kind: "responsibility",
        key: "responsibility-native-key-123",
        body: JSON.stringify(command),
      },
      "a".repeat(64),
      db,
      new Date(now),
    );
    check(
      review.state === "committed",
      "recovery sees committed responsibility receipt",
    );

    const childView = await readD1ResponsibilityView(
      child,
      command.target,
      "",
      db,
    );
    check(
      childView.primary?.member.name === "Responsibility Child" &&
        childView.choices.length === 0,
      "hidden picker preserves child primary",
    );
    const accepted = {
      protocol: "herewoven.responsibility.v1" as const,
      userId: child.userId,
      familyId: child.familyId,
      target: command.target,
      sourceToken: childView.sourceToken,
      expectedRevision: childView.revision,
      issuedAt: new Date(now).toISOString(),
      action: "state-intent" as const,
      slot: "primary" as const,
      decision: "accepted" as const,
      method: "self" as const,
    };
    check(
      (
        await writeD1Responsibility(
          child,
          accepted,
          "responsibility-child-accept",
          db,
          new Date(now),
        )
      ).status === 200,
      "child accepts own responsibility",
    );
    const afterAcceptance = await readD1ResponsibilityView(
      parent,
      command.target,
      "no matching name",
      db,
    );
    check(
      afterAcceptance.primary?.statement?.decision === "accepted" &&
        afterAcceptance.primary.statement.method === "self" &&
        afterAcceptance.backup?.member.name === "Responsibility Parent",
      "search does not erase canonical participants or statements",
    );
    const impersonated = {
      ...accepted,
      userId: parent.userId,
      expectedRevision: afterAcceptance.revision,
    };
    check(
      await writeD1Responsibility(
        parent,
        impersonated,
        "responsibility-impersonated",
        db,
        new Date(now),
      ).then(
        () => false,
        () => true,
      ),
      "parent cannot self-confirm for child account",
    );

    // A root/source or family change between read and commit must abort the
    // entire effect, not merely check the target's old timestamp.
    const beforeRace = await readD1ResponsibilityView(
      parent,
      command.target,
      "",
      db,
    );
    const raced = {
      ...command,
      expectedRevision: beforeRace.revision,
      sourceToken: beforeRace.sourceToken,
      subject: null,
    };
    let injected = false;
    const racing: D1Store = {
      prepare: db.prepare.bind(db),
      batch: db.batch.bind(db),
      withSession: (constraint) => {
        const session = db.withSession(constraint);
        return {
          prepare: session.prepare.bind(session),
          batch: async (statements) => {
            if (!injected) {
              injected = true;
              await db
                .prepare(
                  `UPDATE Family SET features='{"chores":false}' WHERE id=?`,
                )
                .bind(parent.familyId)
                .run();
            }
            return session.batch(statements);
          },
        };
      },
    };
    check(
      await writeD1Responsibility(
        parent,
        raced,
        "responsibility-feature-race",
        racing,
        new Date(now),
      ).then(
        () => false,
        () => true,
      ),
      "feature change before commit refused",
    );
    check(
      !(await db
        .prepare(
          `SELECT id FROM IdempotencyRecord WHERE key='responsibility-feature-race'`,
        )
        .first()),
      "raced effect has no receipt",
    );
    await db
      .prepare(`UPDATE Family SET features=? WHERE id=?`)
      .bind(features, parent.familyId)
      .run();
    check(
      (await readD1ResponsibilityView(parent, command.target, "", db)).backup
        ?.member.name === "Responsibility Parent",
      "raced backup removal rolled back",
    );
    const guard = await db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type='trigger' AND name='Chore_responsibility_epoch'`,
      )
      .first<{ sql: string }>();
    check(guard, "native guard exists");
    await db.prepare(`DROP TRIGGER Chore_responsibility_epoch`).run();
    check(
      await readD1ResponsibilityView(parent, command.target, "", db).then(
        () => false,
        () => true,
      ),
      "missing epoch guard disables new view",
    );
    await db.prepare(guard.sql).run();

    await db
      .prepare(
        `INSERT INTO HouseholdMember (id,family_id,name,role,age) VALUES ('responsibility-profile',?,'Small Child','child',3)`,
      )
      .bind(parent.familyId)
      .run();
    await db
      .prepare(
        `INSERT INTO Chore(id,family_id,title,status,assigned_member_id,created_by,due_date) VALUES ('responsibility-profile-chore',?,'Put toys away','pending','responsibility-profile',?,?)`,
      )
      .bind(parent.familyId, parent.userId, now)
      .run();
    const profileTarget = {
      kind: "chore" as const,
      id: "responsibility-profile-chore",
    };
    const profileView = await readD1ResponsibilityView(
      parent,
      profileTarget,
      "unmatched search",
      db,
    );
    check(
      profileView.primary?.member.name === "Small Child",
      "profile name survives filtered choices",
    );
    const profileIntent = {
      ...accepted,
      userId: parent.userId,
      target: profileTarget,
      sourceToken: profileView.sourceToken,
      expectedRevision: profileView.revision,
      method: "parent-recorded" as const,
    };
    check(
      (
        await writeD1Responsibility(
          parent,
          profileIntent,
          "responsibility-profile-confirm",
          db,
          new Date(now),
        )
      ).status === 200,
      "parent records profile intent",
    );
    const profileConfirmed = await readD1ResponsibilityView(
      parent,
      profileTarget,
      "",
      db,
    );
    check(
      profileConfirmed.primary?.statement?.method === "parent-recorded" &&
        profileConfirmed.primary.statement.byAccountId === parent.userId,
      "profile intent preserves actual actor provenance",
    );
    check(
      await writeD1Responsibility(
        parent,
        {
          ...profileIntent,
          expectedRevision: profileConfirmed.revision,
          method: "self",
        },
        "responsibility-profile-not-self",
        db,
        new Date(now),
      ).then(
        () => false,
        () => true,
      ),
      "profile cannot masquerade as signed-in parent",
    );
    await db
      .prepare(
        `UPDATE HouseholdMember SET archived_at=? WHERE id='responsibility-profile'`,
      )
      .bind(now)
      .run();
    check(
      (await readD1ResponsibilityView(parent, profileTarget, "", db))
        .primary === null,
      "archived profile loses participation",
    );

    await db
      .prepare(
        `INSERT INTO Pickup(id,family_id,title,pickup_time,assigned_to,created_by) VALUES ('responsibility-pickup',?,'School pickup',?,?,?)`,
      )
      .bind(parent.familyId, now, parent.userId, parent.userId)
      .run();
    const pickupTarget = {
      kind: "pickup" as const,
      id: "responsibility-pickup",
    };
    const pickupView = await readD1ResponsibilityView(
      parent,
      pickupTarget,
      "",
      db,
    );
    const pickupIntent = {
      ...accepted,
      userId: parent.userId,
      target: pickupTarget,
      sourceToken: pickupView.sourceToken,
      expectedRevision: pickupView.revision,
    };
    check(
      (
        await writeD1Responsibility(
          parent,
          pickupIntent,
          "responsibility-pickup-accept",
          db,
          new Date(now),
        )
      ).status === 200,
      "pickup owner explicitly accepts",
    );
    await db
      .prepare(`UPDATE Pickup SET completed=1 WHERE id='responsibility-pickup'`)
      .run();
    const closedPickup = await readD1ResponsibilityView(
      parent,
      pickupTarget,
      "",
      db,
    );
    check(
      !closedPickup.active && !closedPickup.writesEnabled,
      "completed pickup cannot receive a new answer",
    );
    check(
      await writeD1Responsibility(
        parent,
        {
          ...pickupIntent,
          sourceToken: closedPickup.sourceToken,
          expectedRevision: closedPickup.revision,
        },
        "responsibility-pickup-closed",
        db,
        new Date(now),
      ).then(
        () => false,
        () => true,
      ),
      "closed pickup write refused",
    );
    await db
      .prepare(
        `INSERT INTO Handoff(id,family_id,sitter_name,share_token,created_by,code_words) VALUES ('responsibility-handoff',?,'External sitter','fixture-private-share',?,'fixture-private-code')`,
      )
      .bind(parent.familyId, parent.userId)
      .run();
    const handoffTarget = {
      kind: "handoff" as const,
      id: "responsibility-handoff",
    };
    const handoffView = await readD1ResponsibilityView(
      parent,
      handoffTarget,
      "",
      db,
    );
    check(
      handoffView.primary === null,
      "sitter name is not an authenticated coordinator",
    );
    check(
      !JSON.stringify(handoffView).includes("fixture-private"),
      "handoff private fields excluded",
    );
    const coordinator = {
      ...command,
      target: handoffTarget,
      sourceToken: handoffView.sourceToken,
      expectedRevision: handoffView.revision,
      action: "set-coordinator" as const,
      subject: { kind: "account" as const, accountId: parent.userId },
    };
    check(
      (
        await writeD1Responsibility(
          parent,
          coordinator,
          "responsibility-coordinator",
          db,
          new Date(now),
        )
      ).status === 200,
      "parent names handoff coordinator",
    );
    const coordinated = await readD1ResponsibilityView(
      parent,
      handoffTarget,
      "",
      db,
    );
    check(
      coordinated.primary?.member.name === "Responsibility Parent" &&
        coordinated.primary.statement === null,
      "naming coordinator does not imply consent",
    );
    check(
      (
        await writeD1Responsibility(
          parent,
          {
            ...accepted,
            userId: parent.userId,
            target: handoffTarget,
            sourceToken: coordinated.sourceToken,
            expectedRevision: coordinated.revision,
          },
          "responsibility-coordinator-accept",
          db,
          new Date(now),
        )
      ).status === 200,
      "coordinator confirms on own account",
    );
    check(
      await readD1ResponsibilityView(child, handoffTarget, "", db).then(
        () => false,
        () => true,
      ),
      "child cannot inspect handoff coordination",
    );

    await db
      .prepare(`DELETE FROM Chore WHERE id=?`)
      .bind(command.target.id)
      .run();
    process.env.FAMILY_RESPONSIBILITY_READY = "0";
    const recovered = await reviewD1ResponsibilityRequest(
      parent,
      {
        kind: "responsibility",
        key: "responsibility-native-key-123",
        body: JSON.stringify(command),
      },
      "a".repeat(64),
      db,
      new Date(now + 20 * 60000),
    );
    check(
      recovered.state === "committed" && recovered.currentRevision === null,
      "historical receipt survives deleted task, expired intent and pause",
    );
    await db
      .prepare(`UPDATE User SET token_version=1 WHERE id=?`)
      .bind(parent.userId)
      .run();
    check(
      await reviewD1ResponsibilityRequest(
        parent,
        {
          kind: "responsibility",
          key: "responsibility-native-key-123",
          body: JSON.stringify(command),
        },
        "a".repeat(64),
        db,
        new Date(now),
      ).then(
        () => false,
        () => true,
      ),
      "revoked session cannot inspect receipt",
    );

    const foreign = await readD1ResponsibilityView(
      { ...parent, familyId: "responsibility-foreign-family", tokenVersion: 1 },
      command.target,
      "",
      db,
    ).then(
      () => false,
      () => true,
    );
    check(foreign, "foreign household is refused");
    return {
      read: true,
      paused: true,
      write: true,
      replay: true,
      recovery: true,
      isolation: true,
      childAcceptance: true,
      profileRecorded: true,
      profileArchive: true,
      pickupAcceptance: true,
      handoffCoordinator: true,
      handoffPrivacy: true,
      searchPreservesParticipants: true,
      featureRace: true,
      missingGuard: true,
      deletedRecovery: true,
      revokedRecovery: true,
    };
  } finally {
    profileFlags.forEach((key, index) => {
      if (previousProfiles[index] === undefined) delete process.env[key];
      else process.env[key] = previousProfiles[index];
    });
    if (previousReady === undefined)
      delete process.env.FAMILY_RESPONSIBILITY_READY;
    else process.env.FAMILY_RESPONSIBILITY_READY = previousReady;
    if (previousOwner === undefined)
      delete process.env.QUEUE_OWNER_RECOVERY_ENABLED;
    else process.env.QUEUE_OWNER_RECOVERY_ENABLED = previousOwner;
    if (previousRollback === undefined)
      delete process.env.QUEUE_OWNER_RECOVERY_ROLLBACK_READY;
    else process.env.QUEUE_OWNER_RECOVERY_ROLLBACK_READY = previousRollback;
  }
}
