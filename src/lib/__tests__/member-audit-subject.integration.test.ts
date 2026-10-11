/**
 * Real PostgreSQL coverage for the ordered audit-subject migration.
 *
 * This suite is deliberately opt-in. Run it only against a disposable,
 * loopback database with RUN_DB_INTEGRATION=1 and FIXTURES_ALLOW=1. The
 * migration owns its own transaction, so malformed-catalog cases commit the
 * deliberately bad shape, run the migration, clear its failed transaction,
 * then restore the canonical shape before the next case.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";

const dbDescribe =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const ROOT = path.resolve(__dirname, "../../..");
const auditSubjectMigration = fs.readFileSync(
  path.join(ROOT, "database/migration-zz-household-member-audit-subjects.sql"),
  "utf8",
);

const FAMILY_A = "fx_audit_subject_family_a";
const FAMILY_B = "fx_audit_subject_family_b";
const ACTOR_A = "fx_audit_subject_actor_a";
const ACTOR_B = "fx_audit_subject_actor_b";
const MEMBER_A = "fx_audit_subject_member_a";
const MEMBER_B = "fx_audit_subject_member_b";
const ACTIVITY_A = "fx_audit_subject_activity_a";
const ACTIVITY_B = "fx_audit_subject_activity_b";
const DEVICE_EVENT_A = "fx_audit_subject_device_event_a";
const DEVICE_EVENT_B = "fx_audit_subject_device_event_b";
const DEVICE_A = "fx_audit_subject_device_a";

jest.setTimeout(60_000);

dbDescribe("audit member subject migration against PostgreSQL", () => {
  let db: pg.Client;

  async function cleanup() {
    await db.query('DELETE FROM "Activity" WHERE family_id = ANY($1::text[])', [
      [FAMILY_A, FAMILY_B],
    ]);
    await db.query(
      'DELETE FROM "DeviceAuditEvent" WHERE family_id = ANY($1::text[])',
      [[FAMILY_A, FAMILY_B]],
    );
    await db.query(
      'DELETE FROM "HouseholdMemberLegacyMapping" WHERE family_id = ANY($1::text[])',
      [[FAMILY_A, FAMILY_B]],
    );
    await db.query(
      'DELETE FROM "HouseholdMemberAccountLink" WHERE family_id = ANY($1::text[])',
      [[FAMILY_A, FAMILY_B]],
    );
    await db.query(
      'DELETE FROM "HouseholdDevice" WHERE family_id = ANY($1::text[])',
      [[FAMILY_A, FAMILY_B]],
    );
    await db.query(
      'DELETE FROM "HouseholdMember" WHERE family_id = ANY($1::text[])',
      [[FAMILY_A, FAMILY_B]],
    );
    await db.query('DELETE FROM "User" WHERE id = ANY($1::text[])', [
      [ACTOR_A, ACTOR_B],
    ]);
    await db.query('DELETE FROM "Family" WHERE id = ANY($1::text[])', [
      [FAMILY_A, FAMILY_B],
    ]);
  }

  async function seed() {
    await db.query(
      'INSERT INTO "Family" (id, name, invite_code) VALUES ($1, $1, $3), ($2, $2, $4)',
      [FAMILY_A, FAMILY_B, `${FAMILY_A}-invite`, `${FAMILY_B}-invite`],
    );
    await db.query(
      'INSERT INTO "User" (id, email, name, family_id, role) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $5)',
      [
        ACTOR_A,
        `${ACTOR_A}@example.test`,
        "Audit actor A",
        FAMILY_A,
        "parent",
        ACTOR_B,
        `${ACTOR_B}@example.test`,
        "Audit actor B",
        FAMILY_B,
      ],
    );
    await db.query(
      'INSERT INTO "HouseholdMember" (id, family_id, name, role) VALUES ($1, $2, $3, $4), ($5, $6, $7, $4)',
      [
        MEMBER_A,
        FAMILY_A,
        "Audit person A",
        "child",
        MEMBER_B,
        FAMILY_B,
        "Audit person B",
      ],
    );
  }

  async function applyMigration() {
    await db.query(auditSubjectMigration);
  }

  /**
   * Run a deliberately malformed committed catalog shape through the
   * migration. The migration must reject it and roll its own transaction
   * back; the restore statement then removes the malformed shape.
   */
  async function expectMigrationToReject(
    mutate: string,
    restore: string,
    expectedMessage: string,
  ) {
    await db.query(mutate);
    let failure: unknown;
    try {
      await applyMigration();
    } catch (error) {
      failure = error;
    }
    // A failed multi-statement query leaves the client in the migration's
    // aborted transaction until the caller explicitly clears it.
    await db.query("ROLLBACK").catch(() => undefined);
    try {
      expect(failure).toBeTruthy();
      expect(String((failure as Error).message)).toContain(expectedMessage);
    } finally {
      await db.query(restore);
      await applyMigration();
    }
  }

  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    // The ordered migration is safe both after the normal application
    // migration and when this suite is run against a fresh prepared schema.
    // Running it twice here is the real idempotence check, not a mock.
    await applyMigration();
    await applyMigration();
  });

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    await cleanup();
    await db.end();
  });

  it("keeps the same migration contract after two real applications", async () => {
    const result = await db.query<{
      activity_fk: string | null;
      device_fk: string | null;
      activity_check: string | null;
      device_check: string | null;
      activity_index: string | null;
      device_index: string | null;
    }>(`
      SELECT
        (SELECT conname FROM pg_constraint WHERE conname = 'Activity_subject_member_fkey') AS activity_fk,
        (SELECT conname FROM pg_constraint WHERE conname = 'DeviceAuditEvent_subject_member_fkey') AS device_fk,
        (SELECT conname FROM pg_constraint WHERE conname = 'Activity_subject_member_erased_check') AS activity_check,
        (SELECT conname FROM pg_constraint WHERE conname = 'DeviceAuditEvent_subject_member_erased_check') AS device_check,
        (SELECT relname FROM pg_class WHERE relname = 'Activity_family_id_subject_member_id_idx') AS activity_index,
        (SELECT relname FROM pg_class WHERE relname = 'DeviceAuditEvent_family_id_subject_member_id_idx') AS device_index
    `);
    expect(result.rows[0]).toEqual({
      activity_fk: "Activity_subject_member_fkey",
      device_fk: "DeviceAuditEvent_subject_member_fkey",
      activity_check: "Activity_subject_member_erased_check",
      device_check: "DeviceAuditEvent_subject_member_erased_check",
      activity_index: "Activity_family_id_subject_member_id_idx",
      device_index: "DeviceAuditEvent_family_id_subject_member_id_idx",
    });
  });

  it("fails closed for an incompatible existing subject column type", async () => {
    await expectMigrationToReject(
      `
        ALTER TABLE "Activity"
          DROP CONSTRAINT "Activity_subject_member_fkey",
          DROP CONSTRAINT "Activity_subject_member_erased_check";
        DROP INDEX "Activity_family_id_subject_member_id_idx";
        ALTER TABLE "Activity"
          ALTER COLUMN "subject_member_id" TYPE VARCHAR
            USING "subject_member_id"::varchar;
      `,
      `ALTER TABLE "Activity"
        ALTER COLUMN "subject_member_id" TYPE TEXT
          USING "subject_member_id"::text`,
      "Activity.subject_member_id must be nullable text without a default",
    );
  });

  it("fails closed for an incompatible existing default", async () => {
    await expectMigrationToReject(
      'ALTER TABLE "Activity" ALTER COLUMN "subject_member_erased" SET DEFAULT true',
      'ALTER TABLE "Activity" ALTER COLUMN "subject_member_erased" SET DEFAULT false',
      "Activity.subject_member_erased must be boolean NOT NULL DEFAULT false",
    );
  });

  it("fails closed for an incompatible existing nullability", async () => {
    await expectMigrationToReject(
      'ALTER TABLE "Activity" ALTER COLUMN "subject_member_erased" DROP NOT NULL',
      'ALTER TABLE "Activity" ALTER COLUMN "subject_member_erased" SET NOT NULL',
      "Activity.subject_member_erased must be boolean NOT NULL DEFAULT false",
    );
  });

  it("fails closed for an incompatible existing subject foreign key", async () => {
    await expectMigrationToReject(
      `
        ALTER TABLE "Activity" DROP CONSTRAINT "Activity_subject_member_fkey";
        ALTER TABLE "Activity"
          ADD CONSTRAINT "Activity_subject_member_fkey"
          FOREIGN KEY ("subject_member_id") REFERENCES "Family"("id")
          ON DELETE NO ACTION ON UPDATE NO ACTION;
      `,
      `ALTER TABLE "Activity" DROP CONSTRAINT "Activity_subject_member_fkey"`,
      "Activity_subject_member_fkey has an incompatible subject foreign key",
    );
  });

  it("fails closed for an incompatible existing erased-subject check", async () => {
    await expectMigrationToReject(
      `
        ALTER TABLE "Activity" DROP CONSTRAINT "Activity_subject_member_erased_check";
        ALTER TABLE "Activity"
          ADD CONSTRAINT "Activity_subject_member_erased_check"
          CHECK (NOT subject_member_erased);
      `,
      `ALTER TABLE "Activity" DROP CONSTRAINT "Activity_subject_member_erased_check"`,
      "Activity_subject_member_erased_check has an incompatible erased-subject check",
    );
  });

  it("fails closed for an incompatible existing subject index", async () => {
    await expectMigrationToReject(
      `
        DROP INDEX "Activity_family_id_subject_member_id_idx";
        CREATE INDEX "Activity_family_id_subject_member_id_idx"
          ON "Activity" (subject_member_id, family_id);
      `,
      `DROP INDEX "Activity_family_id_subject_member_id_idx"`,
      "Activity_family_id_subject_member_id_idx has an incompatible subject index",
    );
  });

  it("allows a subject only when its member and family agree", async () => {
    await db.query(
      `INSERT INTO "Activity"
        (id, family_id, user_id, subject_member_id, type, title)
       VALUES ($1, $2, $3, $4, 'event_test', 'same family')`,
      [ACTIVITY_A, FAMILY_A, ACTOR_A, MEMBER_A],
    );
    await expect(
      db.query(
        `INSERT INTO "Activity"
          (id, family_id, user_id, subject_member_id, type, title)
         VALUES ($1, $2, $3, $4, 'event_test', 'foreign subject')`,
        [ACTIVITY_B, FAMILY_A, ACTOR_A, MEMBER_B],
      ),
    ).rejects.toMatchObject({ code: "23503" });

    await db.query(
      `INSERT INTO "DeviceAuditEvent"
        (id, family_id, actor_user_id, subject_member_id, type)
       VALUES ($1, $2, $3, $4, 'device_test')`,
      [DEVICE_EVENT_A, FAMILY_A, ACTOR_A, MEMBER_A],
    );
    await expect(
      db.query(
        `INSERT INTO "DeviceAuditEvent"
          (id, family_id, actor_user_id, subject_member_id, type)
         VALUES ($1, $2, $3, $4, 'device_test')`,
        [DEVICE_EVENT_B, FAMILY_A, ACTOR_A, MEMBER_B],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("keeps erased subjects irreversible while preserving device audit actors", async () => {
    await db.query(
      `INSERT INTO "Activity"
        (id, family_id, user_id, subject_member_id, type, title)
       VALUES ($1, $2, $3, $4, 'event_test', 'erase me')`,
      [ACTIVITY_A, FAMILY_A, ACTOR_A, MEMBER_A],
    );
    await db.query(
      'UPDATE "Activity" SET subject_member_id = NULL, subject_member_erased = true WHERE id = $1',
      [ACTIVITY_A],
    );
    await expect(
      db.query(
        'UPDATE "Activity" SET subject_member_id = $2, subject_member_erased = false WHERE id = $1',
        [ACTIVITY_A, MEMBER_A],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query(
        'UPDATE "Activity" SET subject_member_id = $2, subject_member_erased = true WHERE id = $1',
        [ACTIVITY_A, MEMBER_A],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await db.query(
      `INSERT INTO "HouseholdDevice" (id, family_id, label, platform, created_by)
       VALUES ($1, $2, 'Audit device', 'web', $3)`,
      [DEVICE_A, FAMILY_A, ACTOR_A],
    );
    await db.query(
      `INSERT INTO "DeviceAuditEvent"
        (id, family_id, device_id, actor_user_id, subject_member_id, type)
       VALUES ($1, $2, $3, $4, $5, 'device.test')`,
      [DEVICE_EVENT_A, FAMILY_A, DEVICE_A, ACTOR_A, MEMBER_A],
    );

    await db.query('DELETE FROM "User" WHERE id = $1', [ACTOR_A]);
    const actor = await db.query<{ actor_user_id: string | null }>(
      'SELECT actor_user_id FROM "DeviceAuditEvent" WHERE id = $1',
      [DEVICE_EVENT_A],
    );
    expect(actor.rows[0]?.actor_user_id).toBeNull();
    const subject = await db.query<{
      subject_member_id: string | null;
      subject_member_erased: boolean;
    }>(
      'SELECT subject_member_id, subject_member_erased FROM "DeviceAuditEvent" WHERE id = $1',
      [DEVICE_EVENT_A],
    );
    expect(subject.rows[0]).toEqual({
      subject_member_id: MEMBER_A,
      subject_member_erased: false,
    });
  });
});
