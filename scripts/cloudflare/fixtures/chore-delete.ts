import {
  deleteD1Chore,
  D1ChoreDeleteReceiptError,
} from "../../../src/lib/cloudflare/chore-delete";
import {
  reviewD1DeleteTarget,
  readD1ChoreDeleteSnapshot,
} from "../../../src/lib/cloudflare/assistant-delete-target";
import {
  assistantSourceGuard,
  AssistantSourceRefused,
  issueAssistantSourceProof,
} from "../../../src/lib/assistant-source-proof";
import {
  assistantDeleteTargetGuard,
  issueDeleteTargetProof,
} from "../../../src/lib/assistant-delete-target";
import {
  referenceAssistantToday,
  type AssistantSourceRow,
} from "../../../src/lib/assistant-references";
import { loadD1AssistantTodayContext } from "../../../src/lib/cloudflare/assistant-context";
import {
  withD1ReadClient,
  type NativeD1,
} from "../../../src/lib/cloudflare/read-client";
import { normalizeFeatures } from "../../../src/lib/features";
import { hashIdempotentRequest } from "../../../src/lib/idempotency-hash";
import type { D1Store } from "../../../src/lib/cloudflare/database";
function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
async function refuses(run: () => Promise<unknown>, code?: string) {
  try {
    await run();
  } catch (cause) {
    check(
      code
        ? cause instanceof D1ChoreDeleteReceiptError && cause.code === code
        : cause instanceof AssistantSourceRefused,
      `Expected refusal: ${cause instanceof Error ? cause.message : "unknown"}`,
    );
    return;
  }
  throw new Error("Expected deletion refusal");
}
export async function testChoreDelete(db: D1Store) {
  const now = new Date(),
    day = Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z"),
    future = day + 100 * 86400000,
    native = db as unknown as NativeD1;
  await db
    .prepare(
      `INSERT INTO "Family"(id,name,invite_code,features) VALUES ('delete-a','Fixture','delete-a','{"chores":true,"calendar":false,"meals":false,"lists":false,"inventory":false}'),('delete-b','Other','delete-b','{"chores":true}')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO "User"(id,email,name,family_id,role) VALUES ('delete-parent','delete-parent@example.test','Parent','delete-a','parent'),('delete-teen','delete-teen@example.test','Teen','delete-a','teen'),('delete-sibling','delete-sibling@example.test','Sibling','delete-a','child'),('delete-other','delete-other@example.test','Other','delete-b','parent')`,
    )
    .run();
  const actor = {
      userId: "delete-parent",
      familyId: "delete-a",
      role: "parent",
      generation: 0,
    },
    teen = { ...actor, userId: "delete-teen", role: "teen" },
    sibling = { ...actor, userId: "delete-sibling", role: "child" },
    options = { database: db, now };
  const seed = async (id: string) =>
    db
      .prepare(
        `INSERT INTO "Chore"(id,family_id,title,description,assigned_to,created_by,due_date) VALUES (?1,'delete-a','Private deletion title','Private details','delete-teen','delete-parent',?2)`,
      )
      .bind(id, future)
      .run();
  const exists = (id: string) =>
    db.prepare(`SELECT id FROM "Chore" WHERE id=?1`).bind(id).first();
  const receiptCount = () =>
    db
      .prepare(
        `SELECT count(*) AS n FROM "IdempotencyRecord" WHERE family_id='delete-a' AND action='chore.delete'`,
      )
      .first<{ n: number }>();
  await seed("delete-race");
  const race = await Promise.all(
    Array.from({ length: 8 }, () =>
      deleteD1Chore(actor, "delete-race", "delete-native-eight", options),
    ),
  );
  check(
    race.every((r) => r.status === 200) &&
      race.filter((r) => r.replayed).length === 7 &&
      !(await exists("delete-race")) &&
      (await receiptCount())?.n === 1,
    "eight deletes one effect and exact receipt",
  );
  await seed("delete-recreated");
  await deleteD1Chore(
    actor,
    "delete-recreated",
    "delete-recreated-key",
    options,
  );
  await seed("delete-recreated");
  check(
    (
      await deleteD1Chore(
        actor,
        "delete-recreated",
        "delete-recreated-key",
        options,
      )
    ).replayed && (await exists("delete-recreated")),
    "replay never deletes a recreated id",
  );
  await refuses(
    () =>
      deleteD1Chore(actor, "delete-recreated", "delete-native-eight", options),
    "IDEMPOTENCY_KEY_REUSED",
  );
  check(
    (await deleteD1Chore(sibling, "delete-recreated", null, options)).status ===
      403,
    "sibling refuses another assignee",
  );
  check(
    (await deleteD1Chore(teen, "delete-recreated", null, options)).status ===
      200,
    "assignee may delete own occurrence",
  );
  check(
    (await deleteD1Chore(actor, "missing", null, options)).status === 404,
    "missing404",
  );
  await db
    .prepare(
      `INSERT INTO "Chore"(id,family_id,title,assigned_to,created_by,due_date) VALUES ('delete-foreign','delete-b','Foreign','delete-other','delete-other',?1)`,
    )
    .bind(future)
    .run();
  check(
    (await deleteD1Chore(actor, "delete-foreign", null, options)).status ===
      403,
    "foreign403",
  );
  await db
    .prepare(
      `INSERT INTO "HouseholdMember"(id,family_id,name,role,age) VALUES ('delete-profile','delete-a','Child','child',3)`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO "Chore"(id,family_id,title,assigned_member_id,created_by,due_date) VALUES ('delete-profile-task','delete-a','Profile','delete-profile','delete-parent',?1)`,
    )
    .bind(future)
    .run();
  check(
    (await deleteD1Chore(actor, "delete-profile-task", null, options))
      .status === 409,
    "profile protocol cannot be deleted through account API",
  );
  await seed("delete-root");
  await db
    .prepare(
      `UPDATE "Chore" SET recurrence_id=id,is_template=1,frequency='weekly' WHERE id='delete-root'`,
    )
    .run();
  check(
    (await deleteD1Chore(actor, "delete-root", null, options)).status === 409,
    "active root requires stop",
  );
  await seed("delete-copy");
  await db
    .prepare(
      `UPDATE "Chore" SET recurrence_id='delete-root',due_date=due_date+86400000 WHERE id='delete-copy'`,
    )
    .run();
  await db
    .prepare(
      `UPDATE "Chore" SET frequency='once',is_template=0 WHERE id='delete-root'`,
    )
    .run();
  check(
    (await deleteD1Chore(actor, "delete-root", null, options)).status === 409,
    "stopped root retains history",
  );
  check(
    (await deleteD1Chore(teen, "delete-copy", null, options)).status === 200 &&
      (await deleteD1Chore(actor, "delete-root", null, options)).status === 200,
    "copy then empty stopped anchor deletion",
  );
  await seed("delete-authored");
  await db
    .prepare(
      `UPDATE "Chore" SET routine_series_config='{"protocol":"herewoven.routine-step-series.v1","unknown":true}' WHERE id='delete-authored'`,
    )
    .run();
  check(
    (
      await deleteD1Chore(
        actor,
        "delete-authored",
        "delete-authored-key",
        options,
      )
    ).status === 409 && (await exists("delete-authored")),
    "unknown future routine editor boundary",
  );
  const racing = (sql: string): D1Store => ({
    prepare: db.prepare.bind(db),
    batch: db.batch.bind(db),
    withSession() {
      const session = db.withSession("first-primary");
      let changed = false;
      return {
        prepare: session.prepare.bind(session),
        async batch(statements) {
          if (!changed) {
            changed = true;
            await db.prepare(sql).run();
          }
          return session.batch(statements);
        },
      };
    },
  });
  await seed("delete-revoke");
  check(
    (
      await deleteD1Chore(actor, "delete-revoke", "delete-revoke-key", {
        ...options,
        database: racing(
          `UPDATE "User" SET token_version=1 WHERE id='delete-parent'`,
        ),
      })
    ).status === 401 && (await exists("delete-revoke")),
    "revoked at commit no effect",
  );
  await db
    .prepare(`UPDATE "User" SET token_version=0 WHERE id='delete-parent'`)
    .run();
  await seed("delete-reassign");
  check(
    (
      await deleteD1Chore(teen, "delete-reassign", null, {
        ...options,
        database: racing(
          `UPDATE "Chore" SET assigned_to='delete-sibling' WHERE id='delete-reassign'`,
        ),
      })
    ).status === 403 && (await exists("delete-reassign")),
    "assignee reassign at commit no effect",
  );
  check(
    (
      await deleteD1Chore(actor, "delete-race", "delete-native-eight", {
        ...options,
        database: racing(
          `UPDATE "Family" SET features='{"chores":false}' WHERE id='delete-a'`,
        ),
      })
    ).status === 403,
    "completed replay renews feature authority",
  );
  await db
    .prepare(
      `UPDATE "Family" SET features='{"chores":true,"calendar":false,"meals":false,"lists":false,"inventory":false}' WHERE id='delete-a'`,
    )
    .run();
  await seed("delete-cascade");
  await db
    .prepare(
      `INSERT INTO "Event"(id,family_id,title,start_time,end_time,created_by) VALUES ('delete-event','delete-a','Prep fixture',?1,?1,'delete-parent')`,
    )
    .bind(future)
    .run();
  await db
    .prepare(
      `INSERT INTO "EventPreparation"(id,family_id,event_id,reviewed_event_source,revision) VALUES ('delete-plan','delete-a','delete-event',?1,4)`,
    )
    .bind("a".repeat(64))
    .run();
  const dependents = async (id: string) => {
    await db
      .prepare(
        `INSERT INTO "ChoreAssignment"(id,family_id,chore_id,assigned_to,due_date) VALUES (?1,'delete-a',?2,'delete-teen',?3)`,
      )
      .bind(id + "-assignment", id, future)
      .run();
    await db
      .prepare(
        `INSERT INTO "EventPreparationStep"(id,family_id,preparation_id,chore_id,position) VALUES (?1,'delete-a','delete-plan',?2,1)`,
      )
      .bind(id + "-step", id)
      .run();
    await db
      .prepare(
        `INSERT INTO "ResponsibilityState"(id,family_id,chore_id,source_token,coordinator_id) VALUES (?1,'delete-a',?2,?3,'delete-parent')`,
      )
      .bind(id + "-responsibility", id, "a".repeat(64))
      .run();
  };
  await dependents("delete-cascade");
  await db
    .prepare(
      `CREATE TRIGGER delete_fail_receipt BEFORE INSERT ON "IdempotencyRecord" WHEN NEW.key='delete-rollback-key' BEGIN SELECT RAISE(ABORT,'forced delete receipt failure'); END`,
    )
    .run();
  let failed = false;
  try {
    await deleteD1Chore(
      actor,
      "delete-cascade",
      "delete-rollback-key",
      options,
    );
  } catch {
    failed = true;
  } finally {
    await db.prepare("DROP TRIGGER delete_fail_receipt").run();
  }
  check(
    failed &&
      (await exists("delete-cascade")) &&
      (await db
        .prepare(
          `SELECT id FROM "ChoreAssignment" WHERE id='delete-cascade-assignment'`,
        )
        .first()) &&
      (await db
        .prepare(
          `SELECT id FROM "EventPreparationStep" WHERE id='delete-cascade-step'`,
        )
        .first()) &&
      (await db
        .prepare(
          `SELECT id FROM "ResponsibilityState" WHERE id='delete-cascade-responsibility'`,
        )
        .first()),
    "receipt failure restores chore and every dependent",
  );
  check(
    (
      await deleteD1Chore(
        actor,
        "delete-cascade",
        "delete-cascade-key",
        options,
      )
    ).status === 200 &&
      !(await db
        .prepare(
          `SELECT id FROM "EventPreparationStep" WHERE id='delete-cascade-step'`,
        )
        .first()) &&
      !(await db
        .prepare(
          `SELECT id FROM "ResponsibilityState" WHERE id='delete-cascade-responsibility'`,
        )
        .first()) &&
      (
        await db
          .prepare(
            `SELECT revision FROM "EventPreparation" WHERE id='delete-plan'`,
          )
          .first<{ revision: number }>()
      )?.revision === 4,
    "dependent cascade retains parent plan/revision by contract",
  );
  await seed("delete-reclaim");
  const hash = hashIdempotentRequest("chore.delete", {
    choreId: "delete-reclaim",
  });
  await db
    .prepare(
      `INSERT INTO "IdempotencyRecord"(id,scope,key,family_id,user_id,action,request_hash,created_at,expires_at) VALUES ('delete-old','user:delete-parent','delete-reclaim-key','delete-a','delete-parent','chore.delete',?1,?2,?3)`,
    )
    .bind(hash, now.getTime() - 1000, now.getTime() + 60000)
    .run();
  await refuses(
    () => deleteD1Chore(actor, "delete-reclaim", "delete-reclaim-key", options),
    "IDEMPOTENCY_IN_PROGRESS",
  );
  await db
    .prepare(
      `UPDATE "IdempotencyRecord" SET created_at=?1 WHERE id='delete-old'`,
    )
    .bind(now.getTime() - 31000)
    .run();
  check(
    (
      await deleteD1Chore(
        actor,
        "delete-reclaim",
        "delete-reclaim-key",
        options,
      )
    ).status === 200,
    "abandoned matching reservation reclaimed",
  );
  const envKeys = [
      "JWT_SECRET",
      "FAMILY_ASSISTANT_CONFIRMATION_READY",
      "FAMILY_ASSISTANT_REFERENCES_READY",
      "ASSISTANT_TODAY_ENABLED",
    ],
    previous = envKeys.map((k) => process.env[k]);
  try {
    process.env.JWT_SECRET = "fabricated-chore-delete-key-not-a-secret";
    process.env.FAMILY_ASSISTANT_CONFIRMATION_READY = "1";
    process.env.FAMILY_ASSISTANT_REFERENCES_READY = "1";
    process.env.ASSISTANT_TODAY_ENABLED = "1";
    const source = async (owner = actor) => {
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
      };
      const context = await loadD1AssistantTodayContext(input, native),
        snapshot = referenceAssistantToday(context, rows, input);
      check(snapshot, "reference source");
      const family = await db
        .prepare(`SELECT features FROM "Family" WHERE id='delete-a'`)
        .first<{ features: string }>();
      const token = issueAssistantSourceProof(
        owner,
        "chore_delete",
        snapshot.context,
        snapshot.catalog,
        normalizeFeatures(JSON.parse(family!.features)),
      );
      return assistantSourceGuard(
        { headers: new Headers({ "X-Assistant-Source-Proof": token }) },
        owner,
        "chore_delete",
      )!;
    };
    const review = async (id: string, owner = actor) => {
      const sourceGuard = await source(owner);
      const response = await reviewD1DeleteTarget(
        owner,
        "chore_delete",
        id,
        sourceGuard,
        db,
      );
      check(
        response.status === 200 && response.body && "target" in response.body,
        "chore target review",
      );
      const target = response.body.target!;
      check(
        target.title === "Private deletion title" &&
          target.detail === new Date(future).toISOString(),
        "canonical title/due date",
      );
      check(
        !Buffer.from(target.proof.split(".")[1], "base64url")
          .toString("utf8")
          .includes("Private deletion"),
        "content-free target proof",
      );
      return {
        sourceGuard,
        targetGuard: assistantDeleteTargetGuard(
          {
            headers: new Headers({ "X-Assistant-Target-Proof": target.proof }),
          },
          owner,
          "chore_delete",
          id,
          true,
        )!,
      };
    };
    await seed("delete-ai");
    const guards = await review("delete-ai");
    const confirmed = await Promise.all(
      Array.from({ length: 8 }, () =>
        deleteD1Chore(actor, "delete-ai", "delete-confirmed-eight", {
          database: db,
          ...guards,
        }),
      ),
    );
    check(
      confirmed.every((r) => r.status === 200) &&
        confirmed.filter((r) => r.replayed).length === 7,
      "confirmed eight-way same-key deletion",
    );
    process.env.FAMILY_ASSISTANT_CONFIRMATION_READY = "0";
    check(
      (
        await deleteD1Chore(actor, "delete-ai", "delete-confirmed-eight", {
          database: db,
          ...guards,
        })
      ).replayed,
      "completed replay with confirmation withdrawn",
    );
    process.env.FAMILY_ASSISTANT_CONFIRMATION_READY = "1";
    await seed("delete-stale");
    const stale = await review("delete-stale");
    await db
      .prepare(
        `UPDATE "Chore" SET description='Changed details' WHERE id='delete-stale'`,
      )
      .run();
    await refuses(() =>
      deleteD1Chore(actor, "delete-stale", "delete-stale-key", {
        database: db,
        ...stale,
      }),
    );
    check(
      await exists("delete-stale"),
      "full target changes hold without effect",
    );
    await seed("delete-child-race");
    const childRace = await review("delete-child-race");
    await refuses(() =>
      deleteD1Chore(actor, "delete-child-race", "delete-child-race-key", {
        database: racing(
          `INSERT INTO "ChoreAssignment"(id,family_id,chore_id,assigned_to,due_date) VALUES ('delete-new-child','delete-a','delete-child-race','delete-teen',${future})`,
        ),
        ...childRace,
      }),
    );
    check(
      await exists("delete-child-race"),
      "empty child insertion at commit invalidates review",
    );
    await seed("delete-teen-own");
    const teenGuard = await review("delete-teen-own", teen);
    check(
      (
        await deleteD1Chore(teen, "delete-teen-own", "delete-teen-own-key", {
          database: db,
          ...teenGuard,
        })
      ).status === 200,
      "teen reviewed own occurrence",
    );
    await seed("delete-cap");
    await db
      .prepare(
        `INSERT INTO "ChoreAssignment"(id,family_id,chore_id,assigned_to,due_date) SELECT value,'delete-a','delete-cap','delete-teen',?2+CAST(key AS INTEGER)*86400000 FROM json_each(?1)`,
      )
      .bind(
        JSON.stringify(
          Array.from({ length: 501 }, (_, i) => "delete-cap-" + i),
        ),
        future,
      )
      .run();
    await refuses(() => review("delete-cap"));
    await seed("delete-expired");
    const snapshot = await withD1ReadClient(
      (db) => readD1ChoreDeleteSnapshot(db, actor.familyId, "delete-expired"),
      native,
    );
    check(snapshot, "expired target snapshot");
    const expired = issueDeleteTargetProof(
      actor,
      "chore_delete",
      "delete-expired",
      snapshot,
      Date.now() - 61000,
    );
    const expiredGuard = assistantDeleteTargetGuard(
      { headers: new Headers({ "X-Assistant-Target-Proof": expired }) },
      actor,
      "chore_delete",
      "delete-expired",
      true,
    )!;
    await refuses(async () =>
      deleteD1Chore(actor, "delete-expired", "delete-expired-key", {
        database: db,
        sourceGuard: await source(),
        targetGuard: expiredGuard,
      }),
    );
  } finally {
    envKeys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
  return {
    manualRace: 8,
    recreatedIdReplay: true,
    receiptKeyReuse: true,
    ownAssigneeAndForeign: true,
    profileRefusal: true,
    seriesAnchors: true,
    authoredRoutineRefusal: true,
    authorityAndAssignmentRaces: true,
    replayFeatureRenewal: true,
    dependentCascade: true,
    parentPlanRevisionRetained: true,
    receiptRollback: true,
    reclaim: true,
    confirmedRace: 8,
    contentFreePreview: true,
    fullTargetAndEmptyChildRaces: true,
    teenOwnConfirmation: true,
    childCap501: true,
    expiredRefusal: true,
    completedReplayWhenFlagOff: true,
  };
}
