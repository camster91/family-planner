import type { D1Store } from "../../../src/lib/cloudflare/database";
import { recordD1FoodAiFeedback } from "../../../src/lib/cloudflare/food-ai-feedback";
import { issueFoodAiFeedback } from "../../../src/lib/food-planning/ai-feedback";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const familyId = "food-feedback-family";
const parent = {
  userId: "food-feedback-parent",
  familyId,
  role: "parent",
  generation: 0,
} as const;
const child = {
  userId: "food-feedback-child",
  familyId,
  role: "child",
  generation: 0,
} as const;

/** Native fixed-vocabulary feedback receipt, privacy opt-out and replay proof. */
export async function testFoodAiFeedback(db: D1Store) {
  const previousReady = process.env.FAMILY_AI_USAGE_READY;
  const previousRollback = process.env.FAMILY_AI_USAGE_ROLLBACK_READY;
  process.env.FAMILY_AI_USAGE_READY = "1";
  process.env.FAMILY_AI_USAGE_ROLLBACK_READY = "1";
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO "Family"(id,name,invite_code,features,beta_metrics_enabled)
           VALUES (?1,'Food feedback','food-feedback-code','{"meals":true}',1)`,
        )
        .bind(familyId),
      db.prepare(
        `INSERT INTO "User"(id,email,name,role,family_id,email_verified,token_version) VALUES
          ('food-feedback-parent','food-feedback-parent@example.test','Feedback Parent','parent',?1,1,0),
          ('food-feedback-child','food-feedback-child@example.test','Feedback Child','child',?1,1,0)`,
      ).bind(familyId),
    ]);

    const now = Date.parse("2026-10-28T16:00:00.000Z");
    const ticket = issueFoodAiFeedback(parent, now);
    const first = await recordD1FoodAiFeedback(
      parent,
      { ticket, decision: "used" },
      db,
      new Date(now),
    );
    check(
      first.status === 200 && (first.body as any).state === "recorded",
      "feedback records",
    );
    const replay = await recordD1FoodAiFeedback(
      parent,
      { ticket, decision: "used" },
      db,
      new Date(now),
    );
    check(replay.replayed === true, "feedback replay is idempotent");
    const count = await db
      .prepare(
        `SELECT count FROM "BetaMetricDaily" WHERE family_id=?1 AND metric='food_ai_choices_used'`,
      )
      .bind(familyId)
      .first<{ count: number }>();
    check(count?.count === 1, "feedback replay counts once");

    const childTicket = issueFoodAiFeedback(child, now);
    check(
      (
        await recordD1FoodAiFeedback(
          child,
          { ticket: childTicket, decision: "kept" },
          db,
          new Date(now),
        )
      ).status === 403,
      "child feedback refused",
    );

    await db
      .prepare(`UPDATE "Family" SET beta_metrics_enabled=0 WHERE id=?1`)
      .bind(familyId)
      .run();
    const skippedTicket = issueFoodAiFeedback(parent, now + 1);
    const skipped = await recordD1FoodAiFeedback(
      parent,
      { ticket: skippedTicket, decision: "kept" },
      db,
      new Date(now + 1),
    );
    check(
      skipped.status === 200 && (skipped.body as any).state === "skipped",
      "feedback privacy opt-out skips receipt",
    );
    const afterOptOut = await db
      .prepare(`SELECT count(*) AS count FROM "IdempotencyRecord" WHERE family_id=?1 AND action='food-ai.feedback.v1'`)
      .bind(familyId)
      .first<{ count: number }>();
    check(afterOptOut?.count === 1, "privacy opt-out creates no receipt");

    return { recorded: true, replayed: true, childRefused: true, privacyOptOut: true };
  } finally {
    if (previousReady === undefined) delete process.env.FAMILY_AI_USAGE_READY;
    else process.env.FAMILY_AI_USAGE_READY = previousReady;
    if (previousRollback === undefined)
      delete process.env.FAMILY_AI_USAGE_ROLLBACK_READY;
    else process.env.FAMILY_AI_USAGE_ROLLBACK_READY = previousRollback;
  }
}
