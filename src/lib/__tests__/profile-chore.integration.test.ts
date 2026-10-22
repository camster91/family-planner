/**
 * Real PostgreSQL proof for the gated email-free profile chore vertical.
 *
 * This suite is opt-in by design. It requires RUN_DB_INTEGRATION=1,
 * FIXTURES_ALLOW=1, a disposable PostgreSQL DATABASE_URL, and an injected
 * Prisma client built from the profile-chore schema via
 * PROFILE_CHORE_PRISMA_CLIENT_MODULE. It never runs against the normal unit
 * test client by accident and never enables the production feature flag.
 */
import type { PrismaClient } from "@prisma/client";
import pg from "pg";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import {
  createProfileOnlyChore,
  createProfileOnlyChoreEffect,
  profileChoreActionAvailability,
  profileChoreCreateSchema,
  readChoreSubject,
} from "@/lib/chore-profile";
import {
  completeProfileChoreInTx,
  profileSubjectForVerify,
  rejectProfileChoreInTx,
  reopenProfileChoreInTx,
} from "@/lib/chore-profile-actions";
import { lockHousehold } from "@/lib/household-lock";
import { hashIdempotentRequest, withIdempotency } from "@/lib/idempotency";
import { expandSeriesInTx } from "@/lib/recurringChores";

const dbDescribe =
  process.env.RUN_DB_INTEGRATION === "1" && process.env.FIXTURES_ALLOW === "1"
    ? describe
    : describe.skip;

const FAMILY_A = "fx_profile_chore_pg_family_a";
const FAMILY_B = "fx_profile_chore_pg_family_b";
const PARENT_A = "fx_profile_chore_pg_parent_a";
const PARENT_B = "fx_profile_chore_pg_parent_b";
const CHILD_A = "fx_profile_chore_pg_child_a";
const TEEN_A = "fx_profile_chore_pg_teen_a";
const BAD_TEEN_A = "fx_profile_chore_pg_bad_teen";
const CHILD_B = "fx_profile_chore_pg_child_b";
const DEVICE_A = "fx_profile_chore_pg_device_a";
const MISSING_DEVICE = "fx_profile_chore_pg_missing_device";

const FAMILY_IDS = [FAMILY_A, FAMILY_B];
const USER_IDS = [PARENT_A, PARENT_B];
const DATE = new Date("2026-10-11T00:00:00.000Z");
const NOON = new Date("2026-10-11T12:00:00.000Z");

type TestDb = PrismaClient & Record<string, any>;

jest.setTimeout(90_000);

async function loadDatabase(): Promise<TestDb> {
  const configuredModule = process.env.PROFILE_CHORE_PRISMA_CLIENT_MODULE;
  if (!configuredModule) {
    throw new Error(
      "Profile-chore PostgreSQL proof requires PROFILE_CHORE_PRISMA_CLIENT_MODULE with the ROOT-owned generated client.",
    );
  }
  const loaded = await import(configuredModule);
  const candidate = loaded as {
    prisma?: unknown;
    default?: { prisma?: unknown } | unknown;
  };
  const configured =
    candidate.prisma ??
    (candidate.default &&
    typeof candidate.default === "object" &&
    "prisma" in candidate.default
      ? (candidate.default as { prisma: unknown }).prisma
      : candidate.default) ??
    loaded;
  if (!configured || typeof configured !== "object") {
    throw new Error(
      "Profile-chore PostgreSQL proof could not find a Prisma client export.",
    );
  }
  const db = configured as TestDb;
  for (const model of [
    "family",
    "user",
    "chore",
    "householdMember",
    "householdDevice",
    "deviceAuditEvent",
    "activity",
    "idempotencyRecord",
  ]) {
    if (!db[model]) {
      throw new Error(
        `Profile-chore PostgreSQL proof needs the generated client model ${model}; check PROFILE_CHORE_PRISMA_CLIENT_MODULE.`,
      );
    }
  }
  return db;
}

function profileInput(memberId: string, title: string) {
  return profileChoreCreateSchema.parse({
    protocol: 2,
    selection: { memberId },
    title,
    description: "A profile-only chore integration fixture",
    points: 10,
    due_date: "2026-10-11",
    difficulty: "easy",
    frequency: "once",
    photo_url: null,
  });
}

dbDescribe("profile-only chores against disposable PostgreSQL", () => {
  let db: TestDb;
  let sql: pg.Client;

  async function cleanup() {
    if (!sql) return;
    // The subject FKs intentionally use NO ACTION. Delete the dependent rows
    // explicitly so cleanup also proves the test owns only these families.
    await sql.query(
      'DELETE FROM "ChoreAssignment" WHERE family_id = ANY($1::text[])',
      [FAMILY_IDS],
    );
    await sql.query(
      'DELETE FROM "DeviceAuditEvent" WHERE family_id = ANY($1::text[])',
      [FAMILY_IDS],
    );
    await sql.query(
      'DELETE FROM "Activity" WHERE family_id = ANY($1::text[])',
      [FAMILY_IDS],
    );
    await sql.query(
      'DELETE FROM "IdempotencyRecord" WHERE family_id = ANY($1::text[])',
      [FAMILY_IDS],
    );
    await sql.query('DELETE FROM "Chore" WHERE family_id = ANY($1::text[])', [
      FAMILY_IDS,
    ]);
    await sql.query(
      'DELETE FROM "HouseholdMemberLegacyMapping" WHERE family_id = ANY($1::text[])',
      [FAMILY_IDS],
    );
    await sql.query(
      'DELETE FROM "HouseholdMemberAccountLink" WHERE family_id = ANY($1::text[])',
      [FAMILY_IDS],
    );
    await sql.query(
      'DELETE FROM "HouseholdDevice" WHERE family_id = ANY($1::text[])',
      [FAMILY_IDS],
    );
    await sql.query(
      'DELETE FROM "HouseholdMember" WHERE family_id = ANY($1::text[])',
      [FAMILY_IDS],
    );
    await sql.query('DELETE FROM "Family" WHERE id = ANY($1::text[])', [
      FAMILY_IDS,
    ]);
    await sql.query('DELETE FROM "User" WHERE id = ANY($1::text[])', [
      USER_IDS,
    ]);
  }

  async function seed() {
    await sql.query(
      'INSERT INTO "Family" (id, name, invite_code) VALUES ($1, $1, $3), ($2, $2, $4)',
      [FAMILY_A, FAMILY_B, `${FAMILY_A}-invite`, `${FAMILY_B}-invite`],
    );
    await sql.query(
      'INSERT INTO "User" (id, email, name, family_id, role) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $5)',
      [
        PARENT_A,
        `${PARENT_A}@example.test`,
        "Fixture parent A",
        FAMILY_A,
        "parent",
        PARENT_B,
        `${PARENT_B}@example.test`,
        "Fixture parent B",
        FAMILY_B,
      ],
    );
    await sql.query(
      'INSERT INTO "HouseholdMember" (id, family_id, name, role, age) VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $8, $9), ($10, $2, $11, $12, $13), ($14, $15, $16, $17, $18)',
      [
        CHILD_A,
        FAMILY_A,
        "Fixture child A",
        "child",
        8,
        TEEN_A,
        "Fixture teen A",
        "teen",
        15,
        BAD_TEEN_A,
        "Fixture invalid teen",
        "teen",
        10,
        CHILD_B,
        FAMILY_B,
        "Fixture child B",
        "child",
        8,
      ],
    );
    await sql.query(
      'INSERT INTO "HouseholdDevice" (id, family_id, label, platform, created_by) VALUES ($1, $2, $3, $4, $5)',
      [DEVICE_A, FAMILY_A, "Profile chore tablet", "web", PARENT_A],
    );
  }

  async function createChore(memberId: string, title: string) {
    return createProfileOnlyChore(
      db,
      { id: PARENT_A, familyId: FAMILY_A },
      profileInput(memberId, title),
      DATE,
      null,
      NOON,
    );
  }

  function recurringProfileInput(memberId: string, title: string) {
    return profileChoreCreateSchema.parse({
      protocol: 2,
      selection: { memberId },
      title,
      description: "A recurring profile routine integration fixture",
      points: 10,
      due_date: "2026-10-12",
      difficulty: "easy",
      frequency: "weekly",
      weekly_days: [1, 4],
      photo_url: null,
      routine: "Morning reset",
      routine_order: 1,
    });
  }

  async function withProfileFeatureEnabled<T>(work: () => Promise<T>) {
    const enabled = process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
    const rollback = process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
    process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = "1";
    process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = "1";
    try {
      return await work();
    } finally {
      if (enabled === undefined)
        delete process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
      else process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = enabled;
      if (rollback === undefined)
        delete process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
      else process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = rollback;
    }
  }

  async function withProfileRecurrenceEnabled<T>(work: () => Promise<T>) {
    const enabled = process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
    const rollback = process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
    const recurrence = process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED;
    process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = "1";
    process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = "1";
    process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED = "1";
    try {
      return await work();
    } finally {
      if (enabled === undefined)
        delete process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED;
      else process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = enabled;
      if (rollback === undefined)
        delete process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY;
      else process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = rollback;
      if (recurrence === undefined)
        delete process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED;
      else
        process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED = recurrence;
    }
  }

  async function expectSqlFailure(
    text: string,
    values: unknown[],
    code: string,
  ) {
    let failure: unknown;
    try {
      await sql.query(text, values);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code });
  }

  async function insertDirectProfileChore(
    id: string,
    familyId: string,
    memberId: string,
    assignedTo: string | null = null,
  ) {
    await sql.query(
      'INSERT INTO "Chore" (id, family_id, title, assigned_to, assigned_member_id, due_date, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, familyId, `Direct ${id}`, assignedTo, memberId, DATE, PARENT_A],
    );
  }

  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    if (
      process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED === "1" ||
      process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY === "1" ||
      process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED === "1"
    ) {
      throw new Error(
        "Profile-chore integration proof must run with HOUSEHOLD_PROFILE_CHORE_ENABLED unset or 0; it never enables production behavior.",
      );
    }
    db = await loadDatabase();
    sql = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await sql.connect();
  });

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    if (sql) {
      await cleanup();
      await sql.end();
    }
    if (db) await db.$disconnect();
  });

  it("keeps profile subjects nullable while the occurrence ledger remains account-required", async () => {
    const columns = await sql.query<{
      table_name: string;
      column_name: string;
      is_nullable: string;
    }>(`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name IN ('Chore', 'ChoreAssignment')
        AND column_name = 'assigned_to'
      ORDER BY table_name
    `);
    expect(columns.rows).toEqual([
      { table_name: "Chore", column_name: "assigned_to", is_nullable: "YES" },
      {
        table_name: "ChoreAssignment",
        column_name: "assigned_to",
        is_nullable: "NO",
      },
    ]);

    await insertDirectProfileChore(
      "fx_profile_chore_pg_direct_nullable",
      FAMILY_A,
      CHILD_A,
    );
    expect(
      await db.chore.count({
        where: {
          id: "fx_profile_chore_pg_direct_nullable",
          assigned_to: null,
        } as any,
      }),
    ).toBe(1);
    await expectSqlFailure(
      'INSERT INTO "ChoreAssignment" (id, family_id, chore_id, assigned_to, assigned_member_id, due_date) VALUES ($1, $2, $3, NULL, $4, $5)',
      [
        "fx_profile_chore_pg_assignment_null",
        FAMILY_A,
        "fx_profile_chore_pg_direct_nullable",
        CHILD_A,
        DATE,
      ],
      "23514",
    );
  });

  it("fails closed for role-age, archived, mapped, and cross-household subjects", async () => {
    await expectSqlFailure(
      'INSERT INTO "Chore" (id, family_id, title, assigned_to, assigned_member_id, due_date, created_by) VALUES ($1, $2, $3, NULL, $4, $5, $6)',
      [
        "fx_profile_chore_pg_bad_age",
        FAMILY_A,
        "Invalid teen age",
        BAD_TEEN_A,
        DATE,
        PARENT_A,
      ],
      "23514",
    );
    await expectSqlFailure(
      'INSERT INTO "Chore" (id, family_id, title, assigned_to, assigned_member_id, due_date, created_by) VALUES ($1, $2, $3, NULL, $4, $5, $6)',
      [
        "fx_profile_chore_pg_foreign_member",
        FAMILY_A,
        "Foreign profile",
        CHILD_B,
        DATE,
        PARENT_A,
      ],
      "23514",
    );

    await sql.query(
      'UPDATE "HouseholdMember" SET archived_at = $1 WHERE id = $2',
      [NOON, CHILD_A],
    );
    await expectSqlFailure(
      'INSERT INTO "Chore" (id, family_id, title, assigned_to, assigned_member_id, due_date, created_by) VALUES ($1, $2, $3, NULL, $4, $5, $6)',
      [
        "fx_profile_chore_pg_archived_member",
        FAMILY_A,
        "Archived profile",
        CHILD_A,
        DATE,
        PARENT_A,
      ],
      "23514",
    );
    await sql.query(
      'UPDATE "HouseholdMember" SET archived_at = NULL WHERE id = $1',
      [CHILD_A],
    );
    await sql.query(
      'INSERT INTO "HouseholdMemberLegacyMapping" (user_id, member_id, family_id) VALUES ($1, $2, $3)',
      [PARENT_A, CHILD_A, FAMILY_A],
    );
    await expectSqlFailure(
      'INSERT INTO "Chore" (id, family_id, title, assigned_to, assigned_member_id, due_date, created_by) VALUES ($1, $2, $3, NULL, $4, $5, $6)',
      [
        "fx_profile_chore_pg_mapped_member",
        FAMILY_A,
        "Mapped profile",
        CHILD_A,
        DATE,
        PARENT_A,
      ],
      "23514",
    );
  });

  it("replays one profile creation and never creates an account or notification", async () => {
    const input = profileInput(CHILD_A, "Idempotent profile chore");
    const key = "fx-profile-chore-idempotency-20261011";
    const context = {
      scope: `user:${PARENT_A}`,
      familyId: FAMILY_A,
      userId: PARENT_A,
      action: "chore.profile.create",
    };
    const before = await Promise.all([
      db.user.count({ where: { family_id: FAMILY_A } }),
      db.notification.count({ where: { user_id: PARENT_A } }),
    ]);
    const run = () =>
      withIdempotency(db, key, context, input, ({ recordId }) =>
        createProfileOnlyChoreEffect(
          db,
          { id: PARENT_A, familyId: FAMILY_A },
          input,
          DATE,
          null,
          recordId,
          NOON,
        ),
      );
    const first = await run();
    const firstBody = await first.json();
    const replay = await run();
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(firstBody);
    expect(
      await db.chore.count({
        where: { family_id: FAMILY_A, assigned_member_id: CHILD_A },
      }),
    ).toBe(1);
    expect(
      await db.idempotencyRecord.count({ where: { family_id: FAMILY_A } }),
    ).toBe(1);
    expect(
      await Promise.all([
        db.user.count({ where: { family_id: FAMILY_A } }),
        db.notification.count({ where: { user_id: PARENT_A } }),
      ]),
    ).toEqual(before);
    const changed = await withIdempotency(
      db,
      key,
      context,
      { ...input, title: "Different payload" },
      async () => ({ status: 200, body: { shouldNotRun: true } }),
    );
    expect(changed.status).toBe(422);
  });

  it("creates bounded selected-weekday profile occurrences and stops safely on lifecycle change", async () => {
    await withProfileRecurrenceEnabled(async () => {
      const input = recurringProfileInput(CHILD_A, "Recurring profile routine");
      const template = await createProfileOnlyChore(
        db,
        { id: PARENT_A, familyId: FAMILY_A },
        input,
        new Date("2026-10-12T00:00:00.000Z"),
        null,
        new Date("2026-10-12T12:00:00.000Z"),
      );
      expect(template).toMatchObject({
        frequency: "weekly",
        weekly_days: [1, 4],
        recurrence_id: template.id,
        is_template: true,
        subject: { kind: "profile", memberId: CHILD_A },
      });

      const series = await db.chore.findMany({
        where: { recurrence_id: template.id },
        orderBy: { due_date: "asc" },
      });
      expect(series.length).toBe(8);
      expect(
        series.map((row: any) => row.due_date.toISOString().slice(0, 10)),
      ).toEqual([
        "2026-10-12",
        "2026-10-15",
        "2026-10-19",
        "2026-10-22",
        "2026-10-26",
        "2026-10-29",
        "2026-11-02",
        "2026-11-05",
      ]);
      expect(
        series.every(
          (row: any) =>
            row.assigned_to === null && row.assigned_member_id === CHILD_A,
        ),
      ).toBe(true);
      expect(series.filter((row: any) => row.is_template)).toHaveLength(1);
      expect(
        await db.choreAssignment.count({ where: { family_id: FAMILY_A } }),
      ).toBe(0);

      expect(
        await completeProfileChoreInTx(db, {
          choreId: template.id,
          familyId: FAMILY_A,
          memberId: CHILD_A,
          deviceId: DEVICE_A,
          now: new Date("2026-10-12T12:00:00.000Z"),
        }),
      ).toBe("completed");
      expect(
        await db.chore.count({ where: { recurrence_id: template.id } }),
      ).toBe(8);

      await db.chore.deleteMany({
        where: {
          recurrence_id: template.id,
          id: { not: template.id },
          status: "pending",
          due_date: { gt: new Date("2026-10-12T00:00:00.000Z") },
          OR: [{ due_date: new Date("2026-11-05T00:00:00.000Z") }],
        },
      });
      await sql.query(
        'UPDATE "HouseholdMember" SET archived_at = $1 WHERE id = $2',
        [NOON, CHILD_A],
      );
      const toppedUp = await db.$transaction((tx: any) =>
        expandSeriesInTx(
          tx,
          template.id,
          FAMILY_A,
          new Date("2026-10-12T12:00:00.000Z"),
        ),
      );
      expect(toppedUp).toBe(0);
      expect(
        await db.chore.count({ where: { recurrence_id: template.id } }),
      ).toBe(7);
    });
  });

  it("retains the recurring profile subject and history when the read capability is rolled back", async () => {
    await withProfileRecurrenceEnabled(async () => {
      const template = await createProfileOnlyChore(
        db,
        { id: PARENT_A, familyId: FAMILY_A },
        recurringProfileInput(CHILD_A, "Paused profile routine"),
        new Date("2026-10-12T00:00:00.000Z"),
        null,
        new Date("2026-10-12T12:00:00.000Z"),
      );
      const stored = await db.chore.findUnique({
        where: { id: template.id },
        select: {
          id: true,
          assigned_to: true,
          assigned_member_id: true,
          member_subject_erased: true,
          frequency: true,
          recurrence_id: true,
          status: true,
          title: true,
        },
      });
      const member = await db.householdMember.findUnique({
        where: { id: CHILD_A },
        select: {
          id: true,
          family_id: true,
          name: true,
          role: true,
          age: true,
          archived_at: true,
          erasure_user_id: true,
          legacy_mapping: { select: { user_id: true } },
          account_link: { select: { user_id: true } },
        },
      });
      const previous = process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED;
      delete process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED;
      try {
        expect(stored).not.toBeNull();
        if (!stored) throw new Error("profile recurrence fixture was not stored");
        expect(stored).toMatchObject({
          assigned_to: null,
          assigned_member_id: CHILD_A,
          frequency: "weekly",
          recurrence_id: template.id,
          status: "pending",
          title: "Paused profile routine",
        });
        expect(
          readChoreSubject(
            { ...stored, assignee: null, assigneeMember: member },
            FAMILY_A,
          ),
        ).toEqual({
          kind: "profile",
          memberId: CHILD_A,
          name: "Fixture child A",
          role: "child",
        });
        expect(profileChoreActionAvailability(stored)?.state).toBe("paused");
        expect(stored.status).toBe("pending");
      } finally {
        if (previous === undefined)
          delete process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED;
        else process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED = previous;
      }
    });
  });

  it("refuses recurring creation before a completed receipt can replay", async () => {
    const input = recurringProfileInput(CHILD_A, "Held recurring profile draft");
    const key = "fx-profile-recurring-gate-20261011";
    const receiptBody = { chore: { id: "never-replay-this" } };
    await db.idempotencyRecord.create({
      data: {
        scope: `user:${PARENT_A}`,
        key,
        family_id: FAMILY_A,
        user_id: PARENT_A,
        action: "chore.profile.create",
        request_hash: hashIdempotentRequest("chore.profile.create", input),
        response_status: 200,
        response_body: receiptBody,
        created_at: NOON,
        expires_at: new Date(NOON.getTime() + 60_000),
      },
    });

    await withProfileFeatureEnabled(async () => {
      const refused = await createProfileOnlyChoreEffect(
        db,
        { id: PARENT_A, familyId: FAMILY_A },
        input,
        DATE,
        null,
        "receipt-not-replayed",
        NOON,
      );
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        error: "MEMBER_PROTOCOL_UNAVAILABLE",
      });
    });
    expect(
      await db.chore.count({
        where: { family_id: FAMILY_A, assigned_member_id: CHILD_A },
      }),
    ).toBe(0);
    expect(
      await db.idempotencyRecord.findUniqueOrThrow({
        where: { id: (await db.idempotencyRecord.findFirstOrThrow({ where: { key } })).id },
      }),
    ).toMatchObject({ response_status: 200, response_body: receiptBody });
  });

  it("retains a pending repeated occurrence when the recurrence gate rolls back", async () => {
    const template = await withProfileRecurrenceEnabled(() =>
      createProfileOnlyChore(
        db,
        { id: PARENT_A, familyId: FAMILY_A },
        recurringProfileInput(CHILD_A, "Rollback repeated profile"),
        new Date("2026-10-12T00:00:00.000Z"),
        null,
        new Date("2026-10-12T12:00:00.000Z"),
      ),
    );
    const occurrence = await db.chore.findFirstOrThrow({
      where: { recurrence_id: template.id, id: { not: template.id } },
      orderBy: { due_date: "asc" },
    });
    const outcome = await completeProfileChoreInTx(db, {
      choreId: occurrence.id,
      familyId: FAMILY_A,
      memberId: CHILD_A,
      deviceId: DEVICE_A,
      now: occurrence.due_date,
    });
    expect(outcome).toBe("profile_unavailable");
    expect(
      await db.chore.findUniqueOrThrow({ where: { id: occurrence.id } }),
    ).toMatchObject({ status: "pending", assigned_to: null });
    expect(
      await db.deviceAuditEvent.count({
        where: { family_id: FAMILY_A, subject_member_id: CHILD_A },
      }),
    ).toBe(0);
  });

  it("serializes concurrent top-ups and keeps one monthly Jan-31 anchor", async () => {
    await withProfileRecurrenceEnabled(async () => {
      const monthly = profileChoreCreateSchema.parse({
        protocol: 2,
        selection: { memberId: CHILD_A },
        title: "Monthly profile anchor",
        due_date: "2027-01-31",
        difficulty: "easy",
        frequency: "monthly",
        photo_url: null,
      });
      const template = await createProfileOnlyChore(
        db,
        { id: PARENT_A, familyId: FAMILY_A },
        monthly,
        new Date("2027-01-31T00:00:00.000Z"),
        null,
        new Date("2027-01-31T12:00:00.000Z"),
      );
      expect(
        (
          await db.chore.findMany({
            where: { recurrence_id: template.id },
            orderBy: { due_date: "asc" },
          })
        ).map((row: any) => row.due_date.toISOString().slice(0, 10)),
      ).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);

      const results = await Promise.all(
        [0, 1].map(() =>
          db.$transaction((tx: any) =>
            expandSeriesInTx(
              tx,
              template.id,
              FAMILY_A,
              new Date("2027-02-28T12:00:00.000Z"),
            ),
          ),
        ),
      );
      expect(results.filter((count) => count > 0)).toHaveLength(1);
      expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
      expect(
        (
          await db.chore.findMany({
            where: { recurrence_id: template.id },
            orderBy: { due_date: "asc" },
          })
        ).map((row: any) => row.due_date.toISOString().slice(0, 10)),
      ).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);

      await db.$transaction((tx: any) =>
        expandSeriesInTx(
          tx,
          template.id,
          FAMILY_A,
          new Date("2027-03-31T12:00:00.000Z"),
        ),
      );
      expect(
        (
          await db.chore.findMany({
            where: { recurrence_id: template.id },
            orderBy: { due_date: "asc" },
          })
        ).map((row: any) => row.due_date.toISOString().slice(0, 10)),
      ).toContain("2027-05-31");
    });
  });

  it("keeps the chore and receipt complete when the outer response store is lost", async () => {
    const input = profileInput(CHILD_A, "Lost response profile chore");
    const key = "fx-profile-chore-response-loss-20261011";
    const context = {
      scope: `user:${PARENT_A}`,
      familyId: FAMILY_A,
      userId: PARENT_A,
      action: "chore.profile.create",
    };
    const real = db;
    let outerStoreFailures = 0;
    const failingRecords = new Proxy(real.idempotencyRecord, {
      get(target, property) {
        if (property === "updateMany" && outerStoreFailures === 0) {
          return async () => {
            outerStoreFailures += 1;
            throw new Error("connection reset after transaction");
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const failingDb = new Proxy(real, {
      get(target, property) {
        if (property === "idempotencyRecord") return failingRecords;
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as TestDb;

    const first = await withIdempotency(
      failingDb,
      key,
      context,
      input,
      ({ recordId }) =>
        createProfileOnlyChoreEffect(
          failingDb,
          { id: PARENT_A, familyId: FAMILY_A },
          input,
          DATE,
          null,
          recordId,
          NOON,
        ),
    );
    expect(first.status).toBe(200);
    expect(outerStoreFailures).toBe(1);
    const firstBody = await first.json();
    expect(
      await db.chore.count({
        where: { family_id: FAMILY_A, assigned_member_id: CHILD_A },
      }),
    ).toBe(1);
    const receipt = await db.idempotencyRecord.findFirstOrThrow({
      where: { family_id: FAMILY_A, key },
    });
    expect(receipt.response_status).toBe(200);
    expect(receipt.response_body).toEqual(firstBody);

    const retry = await withIdempotency(
      db,
      key,
      context,
      input,
      ({ recordId }) =>
        createProfileOnlyChoreEffect(
          db,
          { id: PARENT_A, familyId: FAMILY_A },
          input,
          DATE,
          null,
          recordId,
          NOON,
        ),
    );
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await retry.json()).toEqual(firstBody);
    expect(
      await db.chore.count({
        where: { family_id: FAMILY_A, assigned_member_id: CHILD_A },
      }),
    ).toBe(1);
  });

  it("replays a recurring profile series after the outer response store is lost", async () => {
    await withProfileRecurrenceEnabled(async () => {
      const input = recurringProfileInput(CHILD_A, "Lost recurring response");
      const key = "fx-profile-recurring-response-loss-20261011";
      const context = {
        scope: `user:${PARENT_A}`,
        familyId: FAMILY_A,
        userId: PARENT_A,
        action: "chore.profile.create",
      };
      const real = db;
      let outerStoreFailures = 0;
      const failingRecords = new Proxy(real.idempotencyRecord, {
        get(target, property) {
          if (property === "updateMany" && outerStoreFailures === 0) {
            return async () => {
              outerStoreFailures += 1;
              throw new Error("connection reset after transaction");
            };
          }
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const failingDb = new Proxy(real, {
        get(target, property) {
          if (property === "idempotencyRecord") return failingRecords;
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as TestDb;

      const first = await withIdempotency(
        failingDb,
        key,
        context,
        input,
        ({ recordId }) =>
          createProfileOnlyChoreEffect(
            failingDb,
            { id: PARENT_A, familyId: FAMILY_A },
            input,
            new Date("2026-10-12T00:00:00.000Z"),
            null,
            recordId,
            new Date("2026-10-12T12:00:00.000Z"),
          ),
      );
      expect(first.status).toBe(200);
      expect(outerStoreFailures).toBe(1);
      const firstBody = await first.json();
      const receipt = await db.idempotencyRecord.findFirstOrThrow({
        where: { family_id: FAMILY_A, key },
      });
      expect(receipt.response_status).toBe(200);
      expect(receipt.response_body).toEqual(firstBody);
      expect(
        await db.chore.count({ where: { recurrence_id: firstBody.chore.recurrence_id } }),
      ).toBe(8);

      const retry = await withIdempotency(
        db,
        key,
        context,
        input,
        ({ recordId }) =>
          createProfileOnlyChoreEffect(
            db,
            { id: PARENT_A, familyId: FAMILY_A },
            input,
            new Date("2026-10-12T00:00:00.000Z"),
            null,
            recordId,
            new Date("2026-10-12T12:00:00.000Z"),
          ),
      );
      expect(retry.status).toBe(200);
      expect(retry.headers.get("Idempotency-Replayed")).toBe("true");
      expect(await retry.json()).toEqual(firstBody);
      expect(
        await db.chore.count({ where: { recurrence_id: firstBody.chore.recurrence_id } }),
      ).toBe(8);
    });
  });

  it("takes over an abandoned receipt without creating a second profile chore", async () => {
    const input = profileInput(CHILD_A, "Recovered profile chore");
    const key = "fx-profile-chore-takeover-20261011";
    const context = {
      scope: `user:${PARENT_A}`,
      familyId: FAMILY_A,
      userId: PARENT_A,
      action: "chore.profile.create",
    };
    await db.idempotencyRecord.create({
      data: {
        scope: context.scope,
        key,
        family_id: FAMILY_A,
        user_id: PARENT_A,
        action: context.action,
        request_hash: hashIdempotentRequest(context.action, input),
        created_at: new Date(0),
        expires_at: new Date(Date.now() + 60_000),
      },
    });

    const run = () =>
      withIdempotency(db, key, context, input, ({ recordId }) =>
        createProfileOnlyChoreEffect(
          db,
          { id: PARENT_A, familyId: FAMILY_A },
          input,
          DATE,
          null,
          recordId,
          NOON,
        ),
      );
    const first = await run();
    expect(first.status).toBe(200);
    const replay = await run();
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(
      await db.chore.count({
        where: { family_id: FAMILY_A, assigned_member_id: CHILD_A },
      }),
    ).toBe(1);
  });

  it("persists completion audits privately, undoes the matching chore, and rolls back on audit failure", async () => {
    const first = await createChore(CHILD_A, "First profile completion");
    const second = await createChore(CHILD_A, "Second profile completion");
    expect(
      await completeProfileChoreInTx(db, {
        choreId: first.id,
        familyId: FAMILY_A,
        memberId: CHILD_A,
        deviceId: DEVICE_A,
        now: new Date("2026-10-11T10:00:00.000Z"),
      }),
    ).toBe("completed");
    expect(
      await completeProfileChoreInTx(db, {
        choreId: second.id,
        familyId: FAMILY_A,
        memberId: CHILD_A,
        deviceId: DEVICE_A,
        now: new Date("2026-10-11T10:01:00.000Z"),
      }),
    ).toBe("completed");
    const audits = await db.deviceAuditEvent.findMany({
      where: { family_id: FAMILY_A, subject_member_id: CHILD_A },
      orderBy: { created_at: "asc" },
    });
    expect(audits).toHaveLength(2);
    expect(audits.every((event: any) => event.actor_user_id === null)).toBe(
      true,
    );
    expect(
      audits.every((event: any) => event.subject_member_erased === false),
    ).toBe(true);
    expect(JSON.stringify(audits)).not.toContain("@example.test");

    expect(
      await reopenProfileChoreInTx(db, {
        choreId: first.id,
        familyId: FAMILY_A,
        memberId: CHILD_A,
        deviceId: DEVICE_A,
        now: new Date("2026-10-11T10:02:00.000Z"),
        windowMs: 60 * 60 * 1000,
      }),
    ).toBe("reopened");
    expect(
      (await db.chore.findUniqueOrThrow({ where: { id: first.id } })).status,
    ).toBe("pending");
    expect(
      (await db.chore.findUniqueOrThrow({ where: { id: second.id } })).status,
    ).toBe("completed");

    const rollback = await createChore(CHILD_A, "Rollback profile completion");
    await expect(
      completeProfileChoreInTx(db, {
        choreId: rollback.id,
        familyId: FAMILY_A,
        memberId: CHILD_A,
        deviceId: MISSING_DEVICE,
        now: new Date("2026-10-11T10:03:00.000Z"),
      }),
    ).rejects.toBeDefined();
    expect(
      (await db.chore.findUniqueOrThrow({ where: { id: rollback.id } })).status,
    ).toBe("pending");
    expect(
      await db.deviceAuditEvent.count({
        where: {
          family_id: FAMILY_A,
          subject_member_id: CHILD_A,
          metadata: { path: ["targetId"], equals: rollback.id },
        },
      }),
    ).toBe(0);
  });

  it("verifies and rejects through the parent transaction without XP or notification side effects", async () => {
    const verified = await createChore(
      CHILD_A,
      "Parent verifies profile chore",
    );
    await completeProfileChoreInTx(db, {
      choreId: verified.id,
      familyId: FAMILY_A,
      memberId: CHILD_A,
      deviceId: DEVICE_A,
      now: new Date("2026-10-11T10:10:00.000Z"),
    });
    const xpBefore = (
      await db.user.findUniqueOrThrow({ where: { id: PARENT_A } })
    ).xp;
    const notificationsBefore = await db.notification.count({
      where: { user_id: PARENT_A },
    });
    const activitiesBefore = await db.activity.count({
      where: { family_id: FAMILY_A },
    });
    const approval = await db.$transaction(async (tx: any) => {
      await lockHousehold(tx, FAMILY_A);
      const subject = await profileSubjectForVerify(tx, verified.id, FAMILY_A);
      if (!subject) return "unavailable";
      await tx.chore.update({
        where: { id: verified.id },
        data: {
          status: "verified",
          verified_at: NOON,
          verified_notes: "Looks good",
        },
      });
      await tx.activity.create({
        data: {
          family_id: FAMILY_A,
          user_id: PARENT_A,
          subject_member_id: subject.memberId,
          subject_member_erased: false,
          type: "chore_verified",
          title: "Fixture parent verified a profile chore",
          description: `Verified ${subject.name}'s chore`,
          metadata: JSON.stringify({
            choreId: verified.id,
            subjectMemberId: subject.memberId,
          }),
        },
      });
      return "verified";
    });
    expect(approval).toBe("verified");
    expect(
      (await db.chore.findUniqueOrThrow({ where: { id: verified.id } })).status,
    ).toBe("verified");
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: PARENT_A } })).xp,
    ).toBe(xpBefore);
    expect(await db.notification.count({ where: { user_id: PARENT_A } })).toBe(
      notificationsBefore,
    );
    const activity = await db.activity.findFirstOrThrow({
      where: {
        family_id: FAMILY_A,
        subject_member_id: CHILD_A,
        type: "chore_verified",
      },
    });
    expect(activity.user_id).toBe(PARENT_A);
    expect(activity.description).toContain("Fixture child A");
    expect(activity.metadata).not.toContain("@example.test");
    expect(await db.activity.count({ where: { family_id: FAMILY_A } })).toBe(
      activitiesBefore + 1,
    );

    const rejected = await createChore(CHILD_A, "Parent rejects profile chore");
    await completeProfileChoreInTx(db, {
      choreId: rejected.id,
      familyId: FAMILY_A,
      memberId: CHILD_A,
      deviceId: DEVICE_A,
      now: new Date("2026-10-11T10:11:00.000Z"),
    });
    const rejection = await db.$transaction(async (tx: any) => {
      const outcome = await rejectProfileChoreInTx(tx, {
        choreId: rejected.id,
        familyId: FAMILY_A,
        notes: "Please try again",
      });
      if (outcome === "reopened") {
        const subject = await profileSubjectForVerify(
          tx,
          rejected.id,
          FAMILY_A,
        );
        await tx.activity.create({
          data: {
            family_id: FAMILY_A,
            user_id: PARENT_A,
            subject_member_id: subject?.memberId ?? CHILD_A,
            subject_member_erased: false,
            type: "chore_rejected",
            title: "Fixture parent sent back a profile chore",
            metadata: JSON.stringify({
              choreId: rejected.id,
              subjectMemberId: CHILD_A,
            }),
          },
        });
      }
      return outcome;
    });
    expect(rejection).toBe("reopened");
    const rejectedRow = await db.chore.findUniqueOrThrow({
      where: { id: rejected.id },
    });
    expect(rejectedRow).toMatchObject({
      status: "pending",
      verified_notes: "Please try again",
    });
    expect(await db.notification.count({ where: { user_id: PARENT_A } })).toBe(
      notificationsBefore,
    );

    await sql.query(
      'UPDATE "HouseholdMember" SET archived_at = $1 WHERE id = $2',
      [NOON, CHILD_A],
    );
    expect(
      await profileSubjectForVerify(db as any, rejected.id, FAMILY_A),
    ).toBeNull();
    expect(
      await db.$transaction((tx: any) =>
        rejectProfileChoreInTx(tx, {
          choreId: rejected.id,
          familyId: FAMILY_A,
          notes: "No longer available",
        }),
      ),
    ).toBe("profile_unavailable");
  });

  it("keeps profile action rows scoped to the actor household and refuses stale subjects", async () => {
    const row = await createChore(CHILD_A, "Scoped profile chore");
    expect(
      await profileSubjectForVerify(db as any, row.id, FAMILY_A),
    ).toMatchObject({
      kind: "profile",
      memberId: CHILD_A,
      role: "child",
    });
    expect(
      await profileSubjectForVerify(db as any, row.id, FAMILY_B),
    ).toBeNull();
    // A valid profile chore keeps its presentation subject role/age
    // compatible. A harmless compatible edit is allowed, but changing the
    // same member to an incompatible teen age is rejected by the database
    // trigger and leaves the existing profile untouched.
    await sql.query('UPDATE "HouseholdMember" SET age = $1 WHERE id = $2', [
      9,
      CHILD_A,
    ]);
    await expectSqlFailure(
      'UPDATE "HouseholdMember" SET role = $1, age = $2 WHERE id = $3',
      ["teen", 9, CHILD_A],
      "23514",
    );
    const unchanged = await sql.query<{ role: string; age: number }>(
      'SELECT role, age FROM "HouseholdMember" WHERE id = $1',
      [CHILD_A],
    );
    expect(unchanged.rows).toEqual([{ role: "child", age: 9 }]);
    await sql.query(
      'UPDATE "HouseholdMember" SET archived_at = $1, erasure_user_id = $2 WHERE id = $3',
      [NOON, PARENT_A, CHILD_A],
    );
    expect(
      await profileSubjectForVerify(db as any, row.id, FAMILY_A),
    ).toBeNull();
    expect(
      await completeProfileChoreInTx(db, {
        choreId: row.id,
        familyId: FAMILY_A,
        memberId: CHILD_A,
        deviceId: DEVICE_A,
        now: NOON,
      }),
    ).toBe("profile_unavailable");
  });

  it("keeps erased profile chore identity sticky while allowing history status edits", async () => {
    const row = await createChore(CHILD_A, "Sticky erased profile chore");

    // Mirror the lifecycle erasure state: the identifying profile subject is
    // cleared, while the non-identifying tombstone preserves the history row.
    await sql.query(
      'UPDATE "Chore" SET assigned_member_id = NULL, member_subject_erased = TRUE WHERE id = $1',
      [row.id],
    );

    // Ordinary history changes remain valid after subject erasure. The trigger
    // must guard only the identifying assignment fields, not status history.
    const statusUpdate = await sql.query<{
      status: string;
      assigned_to: string | null;
      assigned_member_id: string | null;
      member_subject_erased: boolean;
    }>(
      'UPDATE "Chore" SET status = $1 WHERE id = $2 RETURNING status, assigned_to, assigned_member_id, member_subject_erased',
      ["completed", row.id],
    );
    expect(statusUpdate.rows).toEqual([
      {
        status: "completed",
        assigned_to: null,
        assigned_member_id: null,
        member_subject_erased: true,
      },
    ]);

    // A parent may not relink retained profile history to an account after
    // erasure, even when the account is in the same household.
    await expectSqlFailure(
      'UPDATE "Chore" SET assigned_to = $1 WHERE id = $2',
      [PARENT_A, row.id],
      "23514",
    );

    const retained = await sql.query<{
      status: string;
      assigned_to: string | null;
      assigned_member_id: string | null;
      member_subject_erased: boolean;
    }>(
      'SELECT status, assigned_to, assigned_member_id, member_subject_erased FROM "Chore" WHERE id = $1',
      [row.id],
    );
    expect(retained.rows).toEqual([
      {
        status: "completed",
        assigned_to: null,
        assigned_member_id: null,
        member_subject_erased: true,
      },
    ]);
  });

  it("keeps same-name catalog objects semantically attached to their profile tables", async () => {
    const constraints = await sql.query<{
      name: string;
      table_name: string;
      definition: string;
    }>(`
      SELECT c.conname AS name, c.conrelid::regclass::text AS table_name,
             pg_get_constraintdef(c.oid, true) AS definition
      FROM pg_constraint c
      WHERE c.conname IN (
        'Chore_at_least_one_subject_check',
        'Chore_member_subject_fkey'
      )
      ORDER BY c.conname
    `);
    expect(constraints.rows).toEqual([
      expect.objectContaining({
        name: "Chore_at_least_one_subject_check",
        table_name: '"Chore"',
      }),
      expect.objectContaining({
        name: "Chore_member_subject_fkey",
        table_name: '"Chore"',
      }),
    ]);
    expect(constraints.rows[0]?.definition).toContain("assigned_member_id");
    expect(constraints.rows[1]?.definition).toContain("HouseholdMember");

    const indexes = await sql.query<{
      name: string;
      table_name: string;
      keys: string;
      is_valid: boolean;
      is_ready: boolean;
      predicate: string | null;
      expressions: string | null;
    }>(`
      SELECT c.relname AS name, i.indrelid::regclass::text AS table_name,
             i.indkey::text AS keys, i.indisvalid AS is_valid,
             i.indisready AS is_ready, pg_get_expr(i.indpred, i.indrelid) AS predicate,
             pg_get_expr(i.indexprs, i.indrelid) AS expressions
      FROM pg_class c
      JOIN pg_index i ON i.indexrelid = c.oid
      WHERE c.relname = 'Chore_family_member_due_idx'
    `);
    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0]).toMatchObject({
      table_name: '"Chore"',
      is_valid: true,
      is_ready: true,
      predicate: null,
      expressions: null,
    });
    expect(indexes.rows[0]?.keys.split(" ")).toHaveLength(3);
  });
});
