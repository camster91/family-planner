import {
  createD1Chore,
  readD1CreatedChore,
  readD1ChoreCreateReceipt,
  D1ChoreCreateReceiptError,
  type ChoreCreateCommand,
} from "../../../src/lib/cloudflare/chore-create";
import { createChoreSchema } from "../../../src/lib/validations";
import { profileChoreCreateSchema } from "../../../src/lib/profile-chore-create-contract";
import { ProfileChoreError } from "../../../src/lib/chore-profile";
import { readChoreCreateReceiptIdentity } from "../../../src/lib/chore-create-receipt-identity";
import { hashIdempotentRequest } from "../../../src/lib/idempotency-hash";
import {
  assistantSourceGuard,
  AssistantSourceRefused,
  issueAssistantSourceProof,
} from "../../../src/lib/assistant-source-proof";
import { loadD1AssistantTodayContext } from "../../../src/lib/cloudflare/assistant-context";
import {
  referenceAssistantToday,
  type AssistantSourceRow,
} from "../../../src/lib/assistant-references";
import { normalizeFeatures } from "../../../src/lib/features";
import type { NativeD1 } from "../../../src/lib/cloudflare/read-client";
import type { D1Store } from "../../../src/lib/cloudflare/database";
function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
export async function testChoreCreate(db: D1Store) {
  const now = new Date("2026-10-28T16:00:00Z"),
    day = "2026-10-28",
    actor = { userId: "create-parent", familyId: "create-a", generation: 0 },
    options = { database: db, now };
  await db
    .prepare(
      `INSERT INTO "Family"(id,name,invite_code,features) VALUES ('create-a','Fixture','create-a','{"chores":true,"gamification":false}'),('create-b','Other','create-b','{"chores":true}')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO "User"(id,email,name,family_id,role) VALUES ('create-parent','create-parent@example.test','Parent','create-a','parent'),('create-teen','create-teen@example.test','Teen','create-a','teen'),('create-other','create-other@example.test','Other','create-b','parent')`,
    )
    .run();
  const command = (
    title: string,
    extra: Record<string, unknown> = {},
  ): ChoreCreateCommand => ({
    kind: "account",
    input: createChoreSchema.parse({
      title,
      assigned_to: "create-teen",
      due_date: day,
      ...extra,
    }),
  });
  const count = async (table: string, where = "family_id='create-a'") =>
    (await db
      .prepare(`SELECT count(*) AS n FROM "${table}" WHERE ${where}`)
      .first<{ n: number }>())!.n;
  const cmd = command("First chore"),
    hash = hashIdempotentRequest("chore.create", cmd.input);
  const race = await Promise.all(
    Array.from({ length: 8 }, () =>
      createD1Chore(actor, cmd, "create-native-eight", options),
    ),
  );
  check(
    race.every((r) => r.status === 200) &&
      race.filter((r) => r.created).length === 1 &&
      race.filter((r) => r.replayed).length === 7 &&
      (await count("Chore")) === 1 &&
      (await count("Activity")) === 1 &&
      (await count("IdempotencyRecord")) === 1,
    "eight creates converge to one chore/activity/receipt",
  );
  const identity = readChoreCreateReceiptIdentity(race[0].body);
  check(identity, "insertion pointer");
  const projection = await readD1CreatedChore(actor, identity, undefined, db);
  check(
    projection.status === 200 &&
      !(
        "points" in
        (projection.body as { chore: Record<string, unknown> }).chore
      ),
    "live projection hides disabled points",
  );
  check(
    JSON.stringify(
      (
        await readD1ChoreCreateReceipt(
          actor,
          "create-native-eight",
          hash,
          "chore.create",
          db,
          now,
        )
      ).body,
    ) === '{"state":"committed","current":"present"}',
    "content-free receipt present",
  );
  const readerBefore = await count("IdempotencyRecord");
  check(
    (
      await readD1ChoreCreateReceipt(
        actor,
        "create-native-eight",
        "a".repeat(64),
        "chore.create",
        db,
        now,
      )
    ).status === 409 && (await count("IdempotencyRecord")) === readerBefore,
    "receipt read cannot prune or mutate",
  );
  let keyRefused = false;
  try {
    await createD1Chore(
      actor,
      command("Changed payload"),
      "create-native-eight",
      options,
    );
  } catch (cause) {
    keyRefused =
      cause instanceof D1ChoreCreateReceiptError &&
      cause.code === "IDEMPOTENCY_KEY_REUSED";
  }
  check(keyRefused, "key reuse refused");
  check(
    (
      await createD1Chore(
        { ...actor, userId: "create-teen" },
        cmd,
        null,
        options,
      )
    ).status === 403,
    "teen cannot create",
  );
  check(
    (
      await createD1Chore(
        actor,
        command("Foreign", { assigned_to: "create-other" }),
        null,
        options,
      )
    ).status === 400,
    "foreign assignee refused",
  );
  check(
    (
      await createD1Chore(
        actor,
        command("Foreign rotation", {
          frequency: "daily",
          rotation: ["create-teen", "create-other"],
        }),
        null,
        options,
      )
    ).status === 400,
    "foreign rotation refused",
  );
  const daily = await createD1Chore(
      actor,
      command("Daily turns", {
        frequency: "daily",
        rotation: ["create-teen", "create-parent"],
        assigned_to: "create-other",
      }),
      "create-daily-turns",
      options,
    ),
    dailyId = readChoreCreateReceiptIdentity(daily.body);
  check(dailyId, "daily identity");
  const dailyRows = await db
    .prepare(
      `SELECT id,assigned_to,rotation_index,responsibility_epoch FROM "Chore" WHERE recurrence_id=?1 ORDER BY due_date`,
    )
    .bind(dailyId.choreId)
    .all<{
      id: string;
      assigned_to: string;
      rotation_index: number;
      responsibility_epoch: number;
    }>();
  check(
    dailyRows.results.length === 7 &&
      dailyRows.results.every(
        (row, i) =>
          row.assigned_to === (i % 2 ? "create-parent" : "create-teen") &&
          row.rotation_index === i % 2,
      ) &&
      dailyRows.results[0].responsibility_epoch === 1,
    "new series includes root once and starts rotation at its next person",
  );
  const weekly = await createD1Chore(
      actor,
      command("Weekdays", { frequency: "weekly", weekly_days: [4, 1] }),
      "create-weekdays",
      options,
    ),
    weeklyId = readChoreCreateReceiptIdentity(weekly.body);
  check(weeklyId, "weekly identity");
  const weeklyRows = await db
    .prepare(
      `SELECT due_date FROM "Chore" WHERE recurrence_id=?1 ORDER BY due_date`,
    )
    .bind(weeklyId.choreId)
    .all<{ due_date: number }>();
  check(
    weeklyRows.results.length === 8 &&
      weeklyRows.results[0].due_date === Date.parse("2026-10-29T00:00:00Z") &&
      weeklyRows.results.every((row) =>
        [1, 4].includes(new Date(row.due_date).getUTCDay()),
      ),
    "selected weekdays align first root and bounded copies",
  );
  const monthly = await createD1Chore(
      actor,
      command("Month anchor", { frequency: "monthly", due_date: "2026-01-31" }),
      "create-month-anchor",
      { database: db, now: new Date("2026-01-31T16:00:00Z") },
    ),
    monthlyId = readChoreCreateReceiptIdentity(monthly.body);
  check(monthlyId, "monthly identity");
  const months = await db
    .prepare(
      `SELECT due_date FROM "Chore" WHERE recurrence_id=?1 ORDER BY due_date`,
    )
    .bind(monthlyId.choreId)
    .all<{ due_date: number }>();
  check(
    months.results
      .map((row) => new Date(row.due_date).toISOString().slice(0, 10))
      .join(",") === "2026-01-31,2026-02-28,2026-03-31",
    "original month anchor survives February clamp",
  );
  const before = {
    chores: await count("Chore"),
    facts: await count("Activity"),
    receipts: await count("IdempotencyRecord"),
  };
  await db
    .prepare(
      `CREATE TRIGGER create_fail_receipt BEFORE INSERT ON "IdempotencyRecord" WHEN NEW.key='create-rollback-key' BEGIN SELECT RAISE(ABORT,'forced create receipt failure'); END`,
    )
    .run();
  let failed = false;
  try {
    await createD1Chore(
      actor,
      command("Rollback series", { frequency: "daily" }),
      "create-rollback-key",
      options,
    );
  } catch {
    failed = true;
  } finally {
    await db.prepare("DROP TRIGGER create_fail_receipt").run();
  }
  check(
    failed &&
      (await count("Chore")) === before.chores &&
      (await count("Activity")) === before.facts &&
      (await count("IdempotencyRecord")) === before.receipts,
    "receipt failure rolls back root all copies and activity",
  );
  const racing = (sql: string, delay = 0): D1Store => ({
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
            if (delay)
              await new Promise((resolve) => setTimeout(resolve, delay));
          }
          return session.batch(statements);
        },
      };
    },
  });
  check(
    (
      await createD1Chore(actor, command("Revoked"), "create-revoked-key", {
        ...options,
        database: racing(
          `UPDATE "User" SET token_version=1 WHERE id='create-parent'`,
        ),
      })
    ).status === 401,
    "revocation before insert refused",
  );
  await db
    .prepare(`UPDATE "User" SET token_version=0 WHERE id='create-parent'`)
    .run();
  await db
    .prepare(
      `INSERT INTO "Upload"(id,family_id,filename,content_type,size_bytes) VALUES ('create-upload','create-a','1122334455667788.png','image/png',100),('create-foreign-upload','create-b','8877665544332211.png','image/png',100)`,
    )
    .run();
  check(
    (
      await createD1Chore(
        actor,
        command("Foreign photo", { photo_url: "8877665544332211.png" }),
        null,
        options,
      )
    ).status === 400,
    "foreign upload refused",
  );
  check(
    (
      await createD1Chore(
        actor,
        command("Deleted upload", { photo_url: "1122334455667788.png" }),
        null,
        {
          ...options,
          database: racing(`DELETE FROM "Upload" WHERE id='create-upload'`),
        },
      )
    ).status === 400,
    "upload deletion at commit refused",
  );
  await db
    .prepare(`DELETE FROM "Chore" WHERE id=?1`)
    .bind(identity.choreId)
    .run();
  check(
    JSON.stringify(
      (
        await readD1ChoreCreateReceipt(
          actor,
          "create-native-eight",
          hash,
          "chore.create",
          db,
          now,
        )
      ).body,
    ) === '{"state":"committed","current":"removed"}',
    "receipt knows removed source",
  );
  await db
    .prepare(
      `INSERT INTO "Chore"(id,family_id,title,assigned_to,created_by,due_date) VALUES (?1,'create-a','Recreated','create-teen','create-parent',?2)`,
    )
    .bind(identity.choreId, now.getTime())
    .run();
  check(
    (await createD1Chore(actor, cmd, "create-native-eight", options))
      .replayed &&
      (await readD1CreatedChore(actor, identity, undefined, db)).status === 409,
    "old birth cannot disclose recreated id",
  );
  const keys = [
      "HOUSEHOLD_PROFILE_CHORE_ENABLED",
      "HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY",
      "HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED",
      "CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED",
      "CHORE_CREATE_NOTIFICATION_DISPATCH_MS",
      "NOTIFICATION_EVENT_ADMISSION_ENABLED",
      "JWT_SECRET",
      "FAMILY_ASSISTANT_CONFIRMATION_READY",
      "FAMILY_ASSISTANT_REFERENCES_READY",
      "ASSISTANT_TODAY_ENABLED",
    ],
    prior = keys.map((k) => process.env[k]);
  try {
    process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = "1";
    process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = "1";
    process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED = "0";
    await db
      .prepare(
        `INSERT INTO "HouseholdMember"(id,family_id,name,role,age) VALUES ('create-profile','create-a','Young child','child',3)`,
      )
      .run();
    const profile = (
      title: string,
      extra: Record<string, unknown> = {},
    ): ChoreCreateCommand => ({
      kind: "profile",
      input: profileChoreCreateSchema.parse({
        protocol: 2,
        selection: { memberId: "create-profile" },
        title,
        due_date: day,
        ...extra,
      }),
    });
    const users = await count("User"),
      profileCmd = profile("Profile once"),
      profileCreated = await createD1Chore(
        actor,
        profileCmd,
        "create-profile-once",
        options,
      ),
      profileId = readChoreCreateReceiptIdentity(profileCreated.body);
    check(profileId, "profile insertion identity");
    check(
      (await count("User")) === users &&
        !profileCreated.created &&
        (profileCreated.body as { chore: { subject: { memberId: string } } })
          .chore.subject.memberId === "create-profile",
      "email-free creation never synthesizes an account or notice recipient",
    );
    check(
      (
        await createD1Chore(
          actor,
          profile("Profile weekly", {
            frequency: "weekly",
            weekly_days: [1, 4],
          }),
          "create-profile-paused",
          options,
        )
      ).status === 409,
      "recurrence opt-in required before keyed response",
    );
    process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED = "1";
    const repeated = await createD1Chore(
        actor,
        profile("Profile daily", { frequency: "daily" }),
        "create-profile-daily",
        options,
      ),
      repeatedId = readChoreCreateReceiptIdentity(repeated.body);
    check(repeatedId, "profile series identity");
    check(
      (await db
        .prepare(
          `SELECT count(*) AS n FROM "Chore" WHERE recurrence_id=?1 AND assigned_to IS NULL AND assigned_member_id='create-profile'`,
        )
        .bind(repeatedId.choreId)
        .first<{ n: number }>())!.n === 7,
      "profile root and copies commit with original subject",
    );
    const currentRevision = (await db
      .prepare(
        `SELECT revision FROM "HouseholdMember" WHERE id='create-profile'`,
      )
      .first<{ revision: number }>())!.revision;
    let conflict = false;
    try {
      await createD1Chore(
        actor,
        {
          ...profile("Profile revision"),
          expectedRevision: currentRevision,
        } as ChoreCreateCommand,
        "create-profile-revision",
        {
          ...options,
          database: racing(
            `UPDATE "HouseholdMember" SET name='Changed child',revision=revision+1 WHERE id='create-profile'`,
          ),
        },
      );
    } catch (cause) {
      conflict =
        cause instanceof ProfileChoreError &&
        cause.code === "PROFILE_TARGET_CONFLICT";
    }
    check(conflict, "reviewed profile revision changes at commit hold");
    process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = "0";
    check(
      (await createD1Chore(actor, profileCmd, "create-profile-once", options))
        .status === 409,
      "profile rollback refuses completed response replay",
    );
    process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = "1";
    process.env.JWT_SECRET = "fabricated-chore-creation-key-not-a-secret";
    process.env.FAMILY_ASSISTANT_CONFIRMATION_READY = "1";
    process.env.FAMILY_ASSISTANT_REFERENCES_READY = "1";
    process.env.ASSISTANT_TODAY_ENABLED = "1";
    await db
      .prepare(
        `INSERT INTO "Family"(id,name,invite_code,features) VALUES ('create-source','Source fixture','create-source','{"calendar":false,"chores":true,"lists":false,"meals":false,"inventory":false}')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO "User"(id,email,name,family_id,role) VALUES ('create-source-parent','create-source-parent@example.test','Source parent','create-source','parent')`,
      )
      .run();
    const owner = {
      userId: "create-source-parent",
      familyId: "create-source",
      role: "parent",
      generation: 0,
    };
    let rows: AssistantSourceRow[] = [];
    const input = {
        ...owner,
        serverNow: new Date(),
        viewerTimeZone: "UTC",
        surface: "person" as const,
        materializeSeries: false,
        onSources(value: AssistantSourceRow[]) {
          rows = value;
        },
      },
      context = await loadD1AssistantTodayContext(
        input,
        db as unknown as NativeD1,
      ),
      snapshot = referenceAssistantToday(context, rows, input);
    check(snapshot, "AI source context");
    const featureRow = await db
        .prepare(`SELECT features FROM "Family" WHERE id='create-source'`)
        .first<{ features: string }>(),
      token = issueAssistantSourceProof(
        owner,
        "chore_create",
        snapshot.context,
        snapshot.catalog,
        normalizeFeatures(JSON.parse(featureRow!.features)),
      ),
      sourceGuard = assistantSourceGuard(
        { headers: new Headers({ "X-Assistant-Source-Proof": token }) },
        owner,
        "chore_create",
      )!;
    const sourceCmd: ChoreCreateCommand = {
      kind: "account",
      input: createChoreSchema.parse({
        title: "AI Today chore",
        assigned_to: owner.userId,
        due_date: new Date().toISOString().slice(0, 10),
      }),
    };
    const signed = await Promise.all(
      Array.from({ length: 8 }, () =>
        createD1Chore(owner, sourceCmd, "create-signed-eight", {
          database: db,
          sourceGuard,
          compact: true,
        }),
      ),
    );
    check(
      signed.every((r) => r.status === 200) &&
        signed.filter((r) => r.replayed).length === 7,
      "same-key signed creates recover after changing their own Today projection",
    );
    let stale = false;
    try {
      await createD1Chore(
        owner,
        { ...sourceCmd, input: { ...sourceCmd.input, title: "Stale source" } },
        "create-signed-stale",
        { database: db, sourceGuard },
      );
    } catch (cause) {
      stale = cause instanceof AssistantSourceRefused;
    }
    check(stale, "different-key stale AI source refused");
    process.env.NOTIFICATION_EVENT_ADMISSION_ENABLED = "1";
    process.env.CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED = "1";
    process.env.CHORE_CREATE_NOTIFICATION_DISPATCH_MS = "60000";
    await db
      .prepare(
        `UPDATE "User" SET quiet_hours_enabled=1,quiet_hours_start='00:00',quiet_hours_end='23:59',quiet_hours_time_zone='UTC' WHERE id='create-teen'`,
      )
      .run();
    const noticeCmd = command("Birth notice", { frequency: "daily" }),
      notice = await createD1Chore(actor, noticeCmd, "create-birth-notice", {
        database: db,
      });
    check(notice.created?.notifiedInTx, "cohort native delivery admitted");
    const notices = await db
      .prepare(
        `SELECT d.status,d.quiet,n.title,n.message,n.action_url FROM "NotificationRecipientDecision" d LEFT JOIN "Notification" n ON n.id=d.notification_id WHERE d.family_id='create-a'`,
      )
      .all<{
        status: string;
        quiet: number;
        title: string;
        message: string;
        action_url: string;
      }>();
    check(
      notices.results.length === 1 &&
        notices.results[0].title === "New Chore Assigned" &&
        notices.results[0].quiet === 1 &&
        notices.results[0].message.includes("Parent assigned you") &&
        notices.results[0].action_url.includes(
          readChoreCreateReceiptIdentity(notice.body)!.choreId,
        ),
      "one root birth notice uses actual creator/target and quiet policy",
    );
    process.env.CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED = "0";
    check(
      (
        await createD1Chore(actor, noticeCmd, "create-birth-notice", {
          database: db,
        })
      ).replayed,
      "cohort withdrawal does not reapply a completed creation",
    );
    process.env.CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED = "1";
    await db
      .prepare(`UPDATE "User" SET notify_chores=0 WHERE id='create-teen'`)
      .run();
    await createD1Chore(actor, command("Muted birth"), "create-muted-birth", {
      database: db,
    });
    check(
      (await db
        .prepare(
          `SELECT count(*) AS n FROM "NotificationRecipientDecision" WHERE family_id='create-a' AND status='suppressed' AND notification_id IS NULL`,
        )
        .first<{ n: number }>())!.n === 1,
      "muted birth is terminal without notice",
    );
    const counts = {
      chores: await count("Chore"),
      facts: await count("Activity"),
      events: await count("NotificationEventOccurrence"),
      receipts: await count("IdempotencyRecord"),
    };
    await db
      .prepare(
        `CREATE TRIGGER create_fail_recipient BEFORE INSERT ON "NotificationRecipientDecision" BEGIN SELECT RAISE(ABORT,'forced birth recipient failure'); END`,
      )
      .run();
    failed = false;
    try {
      await createD1Chore(
        actor,
        command("Birth rollback", { frequency: "daily" }),
        "create-birth-rollback",
        { database: db },
      );
    } catch {
      failed = true;
    } finally {
      await db.prepare("DROP TRIGGER create_fail_recipient").run();
    }
    check(
      failed &&
        (await count("Chore")) === counts.chores &&
        (await count("Activity")) === counts.facts &&
        (await count("NotificationEventOccurrence")) === counts.events &&
        (await count("IdempotencyRecord")) === counts.receipts,
      "recipient failure rolls back root copies fact event and receipt",
    );
    process.env.CHORE_CREATE_NOTIFICATION_DISPATCH_MS = "2000";
    failed = false;
    try {
      await createD1Chore(
        actor,
        command("Birth deadline"),
        "create-birth-deadline",
        { database: racing("", 2100) },
      );
    } catch {
      failed = true;
    }
    check(
      failed &&
        (await db
          .prepare(
            `SELECT count(*) AS n FROM "Chore" WHERE family_id='create-a' AND title='Birth deadline'`,
          )
          .first<{ n: number }>())!.n === 0,
      "expired birth batch rolls back",
    );
  } finally {
    keys.forEach((k, i) => {
      if (prior[i] === undefined) delete process.env[k];
      else process.env[k] = prior[i];
    });
  }
  return {
    createRace: 8,
    oneRootFactReceipt: true,
    privateProjection: true,
    contentFreeReceipt: true,
    removedBirthProof: true,
    keyReuse: true,
    parentAndHouseholdScope: true,
    rotationRootAndCopies: true,
    weekdays: true,
    monthAnchor: true,
    atomicReceiptRollback: true,
    revocationAndPhotoRaces: true,
    emailFreeProfile: true,
    profileRecurrenceGate: true,
    profileRevisionRace: true,
    profileRollbackReplay: true,
    signedTodayRace: 8,
    staleSourceRefusal: true,
    birthNoticeAndQuiet: true,
    mutedTerminalBirth: true,
    birthAtomicRollback: true,
    deadlineRollback: true,
  };
}
