import { readD1RoutineScheduleHandoff } from "../../../src/lib/cloudflare/routine-schedule-handoff";
import { updateD1Chore } from "../../../src/lib/cloudflare/chore-update";
import { createD1Chore } from "../../../src/lib/cloudflare/chore-create";
import {
  createChoreSchema,
  updateChoreSchema,
} from "../../../src/lib/validations";
import type { D1Store } from "../../../src/lib/cloudflare/database";
function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
export async function testChoreUpdate(db: D1Store) {
  const now = new Date("2026-10-28T16:00:00Z"),
    actor = {
      userId: "chore-edit-parent",
      familyId: "chore-edit-a",
      role: "parent",
      generation: 0,
    },
    options = { database: db, now };
  await db
    .prepare(
      `INSERT INTO Family(id,name,invite_code,features) VALUES ('chore-edit-a','Fixture','chore-edit-a','{"chores":true,"gamification":false}'),('chore-edit-b','Other','chore-edit-b','{"chores":true}')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO User(id,email,name,role,family_id) VALUES ('chore-edit-parent','chore-edit-parent@example.test','Parent','parent','chore-edit-a'),('chore-edit-teen','chore-edit-teen@example.test','Teen','teen','chore-edit-a'),('chore-edit-other','chore-edit-other@example.test','Other','parent','chore-edit-b')`,
    )
    .run();
  const row = async (id: string) =>
    db.prepare(`SELECT * FROM Chore WHERE id=?1`).bind(id).first<any>();
  const series = async (id: string) =>
    (
      await db
        .prepare(
          `SELECT * FROM Chore WHERE recurrence_id=?1 ORDER BY due_date,id`,
        )
        .bind(id)
        .all<any>()
    ).results;
  const patch = (input: unknown, who = actor) =>
    updateD1Chore(who, updateChoreSchema.parse(input), options);
  async function create(id: string, extra: Record<string, unknown> = {}) {
    const result = await createD1Chore(
      actor,
      {
        kind: "account",
        input: createChoreSchema.parse({
          title: id,
          assigned_to: "chore-edit-teen",
          due_date: "2026-10-28",
          ...extra,
        }),
      },
      id,
      options,
    );
    check(result.status === 200, "create edit fixture");
    return (result.body as { choreId: string }).choreId;
  }
  const plain = await create("chore-edit-plain");
  const partial = await Promise.all([
    patch({ choreId: plain, title: "New title" }),
    patch({ choreId: plain, description: "New description" }),
    patch({ choreId: plain, icon: "sweep" }),
  ]);
  check(
    partial.every((r) => r.status === 200) &&
      (await row(plain)).title === "New title" &&
      (await row(plain)).description === "New description" &&
      (await row(plain)).icon === "sweep",
    "concurrent partial edits merge",
  );
  const response = partial.find((r) => r.status === 200)!.body as {
    chore: Record<string, unknown>;
  };
  check(
    !("points" in response.chore) &&
      !("routine_series_config" in response.chore),
    "safe edit projection",
  );
  const teen = { ...actor, userId: "chore-edit-teen", role: "teen" };
  check(
    (await patch({ choreId: plain, description: "Own change" }, teen))
      .status === 200,
    "own assignee edit",
  );
  for (const changes of [
    { points: 100 },
    { assigned_to: "chore-edit-parent" },
    { difficulty: "hard" },
    { frequency: "daily" },
    { rotation: ["chore-edit-parent", "chore-edit-teen"] },
  ])
    check(
      (await patch({ choreId: plain, ...changes }, teen)).status === 403,
      "teen privilege refusal",
    );
  check(
    (await patch({ choreId: plain, assigned_to: "chore-edit-other" }))
      .status === 400,
    "foreign assignee",
  );
  check(
    (
      await patch({
        choreId: plain,
        rotation: ["chore-edit-parent", "chore-edit-other"],
      })
    ).status === 400,
    "foreign rotation",
  );
  check(
    (
      await patch({
        choreId: plain,
        rotation: ["chore-edit-parent", "chore-edit-teen"],
      })
    ).status === 400,
    "rotation needs series",
  );
  check(
    (await patch({ choreId: plain }, { ...actor, familyId: "chore-edit-b" }))
      .status === 403,
    "owner family renewal",
  );
  check((await patch({ choreId: "missing" })).status === 404, "missing chore");
  check(
    (await patch({ choreId: plain, due_date: "2026-10-28T23:45:00Z" }))
      .status === 200 &&
      (await row(plain)).due_date === Date.parse("2026-10-28"),
    "date-only normalization",
  );
  check(
    (await patch({ choreId: plain, frequency: "daily" })).status === 200,
    "once starts series",
  );
  check(
    (await series(plain)).length === 7 && (await row(plain)).is_template === 1,
    "new daily window",
  );
  let occurrences = await series(plain);
  const copy = occurrences[1];
  check(
    (
      await patch({
        choreId: copy.id,
        title: "One-off copy",
        frequency: "once",
      })
    ).status === 200 && (await row(plain)).frequency === "daily",
    "copy once does not stop series",
  );
  await db
    .prepare(`UPDATE Chore SET status='completed',completed_at=?1 WHERE id=?2`)
    .bind(now.getTime(), occurrences[2].id)
    .run();
  check(
    (
      await patch({
        choreId: copy.id,
        frequency: "weekly",
        weekly_days: [2, 4],
        apply_to_series: true,
      })
    ).status === 200,
    "copy changes series weekdays",
  );
  occurrences = await series(plain);
  check(
    (await row(plain)).frequency === "weekly" &&
      occurrences.every(
        (r) =>
          r.status !== "pending" ||
          r.due_date < Date.parse("2026-10-29") ||
          [2, 4].includes(new Date(r.due_date).getUTCDay()),
      ),
    "retained future rows retimed",
  );
  check(
    (await row(copy.id)).title === "One-off copy" &&
      (await row(copy.id)).frequency === "once",
    "edited copy identity kept",
  );
  const completed = occurrences.find((r) => r.status === "completed");
  check(
    completed && completed.due_date === Date.parse("2026-10-30"),
    "completed date retained",
  );
  check(
    (await patch({ choreId: plain, frequency: "once" })).status === 200,
    "stop template",
  );
  occurrences = await series(plain);
  check(
    (await row(plain)).is_template === 0 &&
      occurrences.every(
        (r) =>
          r.id === plain ||
          r.status !== "pending" ||
          r.due_date < Date.parse("2026-10-29"),
      ),
    "stop removes pending future only",
  );
  const rotating = await create("chore-edit-rotating", {
    frequency: "daily",
    rotation: ["chore-edit-parent", "chore-edit-teen"],
  });
  let rotationRows = await series(rotating);
  const hand = rotationRows[2];
  await patch({
    choreId: hand.id,
    assigned_to:
      hand.assigned_to === "chore-edit-parent"
        ? "chore-edit-teen"
        : "chore-edit-parent",
  });
  const handOwner = (await row(hand.id)).assigned_to;
  const changed = await patch({
    choreId: rotating,
    rotation: ["chore-edit-teen", "chore-edit-parent"],
  });
  check(changed.status === 200, "rotation change");
  rotationRows = await series(rotating);
  check(
    (await row(hand.id)).assigned_to === handOwner &&
      (await row(hand.id)).rotation_index === null,
    "manual pick preserved",
  );
  const planned = rotationRows.filter(
    (r) => r.due_date >= Date.parse("2026-10-29") && r.id !== hand.id,
  );
  check(
    planned.every(
      (r, i) =>
        r.assigned_to ===
          (i % 2 === 0 ? "chore-edit-teen" : "chore-edit-parent") &&
        r.rotation_index === i % 2,
    ),
    "future turns restart",
  );
  check(
    (await patch({ choreId: rotating, rotation: null })).status === 200 &&
      (await series(rotating)).every((r) => r.rotation_index === null),
    "clear rotation retains people",
  );
  const fresh = await create("chore-edit-combined");
  check(
    (
      await patch({
        choreId: fresh,
        frequency: "weekly",
        weekly_days: [1, 3],
        rotation: ["chore-edit-parent", "chore-edit-teen"],
      })
    ).status === 200,
    "start weekly and rotation together",
  );
  check((await series(fresh)).length === 8, "combined selected day window");
  await db
    .prepare(
      `INSERT INTO HouseholdMember(id,family_id,name,role,age) VALUES ('chore-edit-profile','chore-edit-a','Young child','child',3)`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO Chore(id,family_id,title,assigned_member_id,created_by,due_date) VALUES ('chore-edit-profile-chore','chore-edit-a','Private','chore-edit-profile','chore-edit-parent',?1)`,
    )
    .bind(now.getTime())
    .run();
  check(
    (await patch({ choreId: "chore-edit-profile-chore", title: "Refused" }))
      .status === 409,
    "profile separate protocol",
  );
  check(
    (
      await patch({
        choreId: fresh,
        photo_url: "https://example.test/private.jpg",
      })
    ).status === 400,
    "unowned photo refused",
  );
  const authored = await create("chore-edit-authored", { frequency: "daily" });
  const definition = {
    protocol: "herewoven.routine-step-series.v1",
    revision: 1,
    once_pending: false,
    stack_id: null,
    state: "active",
    effective_on: "2026-10-28",
    anchor: "After breakfast",
    schedule: {
      frequency: "daily",
      starts_on: "2026-10-28",
      weekly_days: [],
      monthly_day: null,
    },
    content: {
      title: "Future step",
      description: null,
      subject: { kind: "account", user_id: actor.userId, member_id: null },
      points: 8,
      difficulty: "easy",
      icon: null,
      duration_minutes: 10,
    },
  };
  await db
    .prepare(`UPDATE Chore SET routine_series_config=?1 WHERE id=?2`)
    .bind(JSON.stringify(definition), authored)
    .run();
  check(
    (await patch({ choreId: authored, title: "Cannot edit definition" }))
      .status === 409,
    "authored root requires schedule editor",
  );
  check(
    (await readD1RoutineScheduleHandoff(
      actor.familyId,
      "chore",
      authored,
      db,
    )) === `/dashboard/chores/schedules/independent?root_id=${authored}`,
    "independent schedule handoff",
  );
  check(
    (await readD1RoutineScheduleHandoff(
      "chore-edit-b",
      "chore",
      authored,
      db,
    )) === null,
    "foreign handoff refused",
  );
  await db
    .prepare(
      `UPDATE Chore SET routine_series_config='{"protocol":"herewoven.routine-step-series.v1"}' WHERE id=?1`,
    )
    .bind(authored)
    .run();
  check(
    (await readD1RoutineScheduleHandoff(
      actor.familyId,
      "chore",
      authored,
      db,
    )) === "/dashboard/chores/schedules",
    "malformed definition handoff fallback",
  );
  const authoredCopy = (await series(authored)).find((r) => r.id !== authored)!;
  check(
    (
      await patch({
        choreId: authoredCopy.id,
        title: "Cannot edit unsupported occurrence",
      })
    ).status === 409,
    "malformed root occurrence refused",
  );
  // Force a late effect failure: material changes and removals must both roll back.
  const rollback = await create("chore-edit-rollback", { frequency: "daily" });
  const before = await series(rollback);
  await db
    .prepare(
      `CREATE TRIGGER edit_fail_stop BEFORE DELETE ON Chore WHEN OLD.recurrence_id='${rollback}' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END`,
    )
    .run();
  let failed = false;
  try {
    await patch({
      choreId: rollback,
      title: "Must roll back",
      frequency: "once",
    });
  } catch {
    failed = true;
  }
  await db.prepare("DROP TRIGGER edit_fail_stop").run();
  check(
    failed &&
      (await row(rollback)).title === "chore-edit-rollback" &&
      JSON.stringify(await series(rollback)) === JSON.stringify(before),
    "whole edit and series rollback",
  );
  // A session changed between planning and its batch cannot update the row.
  let changedAtCommit = false;
  const wrapped: D1Store = {
    prepare: db.prepare.bind(db),
    batch: db.batch.bind(db),
    withSession() {
      const source = db.withSession("first-primary");
      return {
        prepare: source.prepare.bind(source),
        async batch(statements) {
          if (!changedAtCommit) {
            changedAtCommit = true;
            await db
              .prepare(
                `UPDATE User SET token_version=1 WHERE id='chore-edit-parent'`,
              )
              .run();
          }
          return source.batch(statements);
        },
      };
    },
  };
  const denied = await updateD1Chore(
    actor,
    updateChoreSchema.parse({ choreId: rollback, title: "Revoked write" }),
    { ...options, database: wrapped },
  );
  check(
    denied.status === 401 &&
      (await row(rollback)).title === "chore-edit-rollback",
    "commit revocation refusal",
  );
  return {
    partialMerge: 3,
    privateProjection: true,
    assigneeOwnEdit: true,
    parentOnlyFields: true,
    foreignRefusal: true,
    dateOnly: true,
    startDaily: true,
    copyOnceSafe: true,
    selectedWeekdays: true,
    completedHistory: true,
    stopFutureOnly: true,
    manualRotationPick: true,
    rotationReplanAndClear: true,
    combinedStart: true,
    profileProtocol: true,
    atomicRollback: true,
    photoOwnership: true,
    authoredRoutineRefusal: true,
    scopedScheduleHandoff: true,
    revocationRace: true,
  };
}
