import type { D1Store } from "../../../src/lib/cloudflare/database";
import {
  captureD1ScheduleSource,
  readD1ScheduleSnapshot,
  previewD1ScheduleQuery,
} from "../../../src/lib/cloudflare/schedule-source";
import { writeD1ScheduleMove } from "../../../src/lib/cloudflare/schedule-write";
import { reviewD1ScheduleRequest } from "../../../src/lib/cloudflare/schedule-recovery";
import {
  planScheduleReview,
  previewScheduleMove,
  type ScheduleReviewQuery,
} from "../../../src/lib/calendar-planning/conflict-review";
function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
async function refuses(action: () => Promise<unknown>, label: string) {
  let failed = false;
  try {
    await action();
  } catch {
    failed = true;
  }
  check(failed, label);
}
export async function testScheduleReview(db: D1Store) {
  const flags = [
    "FAMILY_SCHEDULE_REVIEW_READY",
    "QUEUE_OWNER_RECOVERY_ENABLED",
    "QUEUE_OWNER_RECOVERY_ROLLBACK_READY",
  ];
  const previous = flags.map((k) => process.env[k]);
  flags.forEach((k) => (process.env[k] = "1"));
  try {
    await db
      .prepare(
        `INSERT INTO Family (id,name,invite_code,features) VALUES ('schedule-a','Fixture schedule','schedule-a','{"calendar":true}'),('schedule-b','Foreign','schedule-b','{"calendar":true}')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO User (id,email,name,family_id,role) VALUES ('schedule-parent','schedule-parent@example.test','Parent','schedule-a','parent'),('schedule-child','schedule-child@example.test','Child','schedule-a','child'),('schedule-foreign','schedule-foreign@example.test','Foreign','schedule-b','parent')`,
      )
      .run();
    const actor = {
      userId: "schedule-parent",
      familyId: "schedule-a",
      tokenVersion: 0,
    };
    const now = new Date("2026-11-03T07:00:00Z");
    async function insert(id: string, start: string, end: string) {
      await db
        .prepare(
          `INSERT INTO Event (id,family_id,created_by,title,start_time,end_time) VALUES (?,'schedule-a','schedule-parent',?,?,?)`,
        )
        .bind(id, "Fixture " + id, Date.parse(start), Date.parse(end))
        .run();
    }
    await insert(
      "schedule-event",
      "2026-11-03T10:00:00Z",
      "2026-11-03T11:00:00Z",
    );
    const scope = {
      targetId: "schedule-event",
      range: { start: "2026-11-03T00:00:00Z", end: "2026-11-04T00:00:00Z" },
      timeZone: "UTC",
    };
    async function intent() {
      const { snapshot } = await readD1ScheduleSnapshot(actor, scope, db, now);
      const query: ScheduleReviewQuery = {
        protocol: "herewoven.schedule-review.v1",
        owner: snapshot.owner,
        range: snapshot.range,
        timeZone: "UTC",
        snapshotToken: snapshot.snapshotToken,
        target: {
          id: scope.targetId,
          sourceToken: snapshot.events.find((e) => e.id === scope.targetId)!
            .sourceToken,
        },
        buffers: { preparation: 0, travelBefore: 0, travelAfter: 0 },
        otherBuffers: [],
        windows: [
          { start: "2026-11-03T08:00:00Z", end: "2026-11-03T16:00:00Z" },
        ],
        gridMinutes: 15,
      };
      const plan = planScheduleReview(snapshot, query, now);
      check(
        plan.canApply && plan.alternatives.length,
        "available alternatives",
      );
      await previewD1ScheduleQuery(actor, query, db, now);
      return previewScheduleMove(snapshot, query, plan.alternatives[0], now);
    }
    const first = await intent();
    const capture = await captureD1ScheduleSource(actor, scope, db, now);
    await insert(
      "schedule-blocker",
      "2026-11-03T08:00:00Z",
      "2026-11-03T09:00:00Z",
    );
    await refuses(
      () => db.batch(capture.checks(db)),
      "new conflict invalidates captured source",
    );
    await refuses(
      () => writeD1ScheduleMove(actor, first, "schedule_stale_01", db, now),
      "stale move denied",
    );
    check(
      !(await db
        .prepare(
          `SELECT id FROM IdempotencyRecord WHERE key='schedule_stale_01'`,
        )
        .first()),
      "stale move has no receipt",
    );
    const command = await intent(),
      key = "schedule_move_001";
    const entry = {
      kind: "schedule-move" as const,
      key,
      body: JSON.stringify(command),
    };
    check(
      (await reviewD1ScheduleRequest(actor, entry, "a".repeat(64), db, now))
        .state === "ready",
      "review ready",
    );
    const result = await writeD1ScheduleMove(actor, command, key, db, now);
    check(result.status === 200, "move committed");
    const saved = await db
      .prepare(
        `SELECT start_time,schedule_epoch FROM Event WHERE id='schedule-event'`,
      )
      .first<{ start_time: number; schedule_epoch: number }>();
    check(
      saved?.start_time === Date.parse(command.start) &&
        saved.schedule_epoch > 0,
      "canonical move and epoch",
    );
    check(
      (await writeD1ScheduleMove(actor, command, key, db, now)).replayed,
      "exact retry replays",
    );
    check(
      (
        await db
          .prepare(
            `SELECT count(*) AS count FROM Activity WHERE family_id='schedule-a' AND type='schedule_changed'`,
          )
          .first<{ count: number }>()
      )?.count === 1,
      "only one timeline fact",
    );
    await refuses(
      () =>
        readD1ScheduleSnapshot(
          {
            userId: "schedule-foreign",
            familyId: "schedule-b",
            tokenVersion: 0,
          },
          scope,
          db,
          now,
        ),
      "foreign target hidden",
    );
    const child = await readD1ScheduleSnapshot(
      { ...actor, userId: "schedule-child" },
      scope,
      db,
      now,
    );
    check(
      child.snapshot.events.every((e) => !e.canMove),
      "child view cannot move",
    );
    const second = await intent();
    await db
      .prepare(
        `CREATE TRIGGER schedule_fixture_failure BEFORE INSERT ON Activity WHEN NEW.type='schedule_changed' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END`,
      )
      .run();
    await refuses(
      () => writeD1ScheduleMove(actor, second, "schedule_rollback_01", db, now),
      "timeline failure rolls back",
    );
    await db.prepare(`DROP TRIGGER schedule_fixture_failure`).run();
    check(
      (
        await db
          .prepare(`SELECT start_time FROM Event WHERE id='schedule-event'`)
          .first<{ start_time: number }>()
      )?.start_time === Date.parse(command.start),
      "failed move rolled back",
    );
    check(
      !(await db
        .prepare(
          `SELECT id FROM IdempotencyRecord WHERE key='schedule_rollback_01'`,
        )
        .first()),
      "failed move no receipt",
    );
    process.env.FAMILY_SCHEDULE_REVIEW_READY = "0";
    await db.prepare(`DELETE FROM Event WHERE id='schedule-event'`).run();
    check(
      (await reviewD1ScheduleRequest(actor, entry, "a".repeat(64), db, now))
        .state === "committed",
      "receipt recovery survives deletion and pause",
    );
    check(
      (await writeD1ScheduleMove(actor, command, key, db, now)).replayed,
      "receipt replay survives deletion and pause",
    );
    await db
      .prepare(`UPDATE User SET token_version=1 WHERE id='schedule-parent'`)
      .run();
    await refuses(
      () => writeD1ScheduleMove(actor, command, key, db, now),
      "revoked actor cannot replay",
    );
    await refuses(
      () => reviewD1ScheduleRequest(actor, entry, "a".repeat(64), db, now),
      "revoked actor cannot inspect",
    );
    return {
      passed: true,
      checks: [
        "native-read-preview",
        "phantom-conflict",
        "stale-no-effect",
        "move-epoch",
        "receipt-replay",
        "role-family-isolation",
        "atomic-rollback",
        "paused-deleted-recovery",
        "revoked-session",
      ],
    };
  } finally {
    flags.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
}
