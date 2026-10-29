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
});

/** Disposable native coverage for source-bound consent and assignment state. */
export async function testResponsibility(db: D1Store) {
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
        .prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES (?1,'Responsibility family',?2,?3)`)
        .bind(parent.familyId, "responsibility-native-code", features),
      db
        .prepare(`INSERT INTO "User"(id,email,name,role,family_id,email_verified,token_version) VALUES
          (?1,'responsibility-parent@example.test','Responsibility Parent','parent',?3,1,0),
          (?2,'responsibility-child@example.test','Responsibility Child','child',?3,1,0)`)
        .bind(parent.userId, child.userId, parent.familyId),
      db
        .prepare(`INSERT INTO "Chore"(id,family_id,title,status,assigned_to,created_by,due_date) VALUES (?1,?2,'Clean room','pending',?3,?4,?5)`)
        .bind("responsibility-native-chore", parent.familyId, child.userId, parent.userId, now),
    ]);

    const initial = await readD1ResponsibilityView(
      parent,
      { kind: "chore", id: "responsibility-native-chore" },
      "",
      db,
    );
    check(initial.primary?.member.subject.kind === "account" && initial.primary.member.subject.accountId === child.userId, "primary assignment is visible");
    check(initial.revision === 0 && initial.sourceToken.length === 64, "source and revision are fresh");
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
      await writeD1Responsibility(parent, command, "responsibility-native-paused", db, new Date(now));
    } catch (error) {
      paused = (error as { code?: string }).code === "UNAVAILABLE";
    }
    check(paused, "paused responsibility write is refused");
    process.env.QUEUE_OWNER_RECOVERY_ENABLED = "1";

    const written = await writeD1Responsibility(parent, command, "responsibility-native-key-123", db, new Date(now));
    check(written.status === 200, "responsibility assignment receipt");
    const replay = await writeD1Responsibility(parent, command, "responsibility-native-key-123", db, new Date(now));
    check(replay.replayed === true, "responsibility receipt replay");
    const updated = await readD1ResponsibilityView(
      parent,
      command.target,
      "",
      db,
    );
    check(updated.backup?.member.subject.kind === "account" && updated.backup.member.subject.accountId === parent.userId && updated.revision === 1, "backup state is projected");

    const review = await reviewD1ResponsibilityRequest(parent, {
      kind: "responsibility",
      key: "responsibility-native-key-123",
      body: JSON.stringify(command),
    }, "a".repeat(64), db, new Date(now));
    check(review.state === "committed", "recovery sees committed responsibility receipt");

    const foreign = await readD1ResponsibilityView(
      { ...parent, familyId: "responsibility-foreign-family" },
      command.target,
      "",
      db,
    ).then(() => false, () => true);
    check(foreign, "foreign household is refused");
    return { read: true, paused: true, write: true, replay: true, recovery: true, isolation: true };
  } finally {
    if (previousReady === undefined) delete process.env.FAMILY_RESPONSIBILITY_READY;
    else process.env.FAMILY_RESPONSIBILITY_READY = previousReady;
    if (previousOwner === undefined) delete process.env.QUEUE_OWNER_RECOVERY_ENABLED;
    else process.env.QUEUE_OWNER_RECOVERY_ENABLED = previousOwner;
    if (previousRollback === undefined) delete process.env.QUEUE_OWNER_RECOVERY_ROLLBACK_READY;
    else process.env.QUEUE_OWNER_RECOVERY_ROLLBACK_READY = previousRollback;
  }
}
