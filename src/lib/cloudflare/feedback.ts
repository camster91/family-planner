import type { EffectResult } from "@/lib/idempotency";
import type { D1Store } from "./database";
import { getD1Database } from "./database";

export type D1FeedbackActor = {
  userId: string;
  familyId: string;
  generation: number;
};

type FeedbackRow = {
  id: string;
  user_id: string;
  family_id: string;
  request_id: string;
  kind: string;
  title: string;
  details: string;
  page: string;
  status: string;
  created_at: number;
};

const summary = (row: FeedbackRow) => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  status: row.status,
  created_at: new Date(row.created_at),
});

const report = (row: FeedbackRow) => ({
  ...row,
  created_at: new Date(row.created_at),
});

async function currentActor(
  db: Pick<D1Store, "prepare">,
  actor: D1FeedbackActor,
) {
  return db
    .prepare('SELECT family_id,token_version FROM "User" WHERE id=?1')
    .bind(actor.userId)
    .first<{ family_id: string | null; token_version: number }>();
}

function authorized(
  row: { family_id: string | null; token_version: number } | null,
  actor: D1FeedbackActor,
) {
  return Boolean(
    row &&
    row.family_id === actor.familyId &&
    row.token_version === actor.generation,
  );
}

export async function readD1Feedback(
  actor: D1FeedbackActor,
  summaryOnly: boolean,
  database?: D1Store,
): Promise<EffectResult> {
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  if (!authorized(await currentActor(db, actor), actor))
    return { status: 401, body: { error: "Unauthorized" } };
  const columns = summaryOnly
    ? "id,kind,title,status,created_at"
    : "id,user_id,family_id,request_id,kind,title,details,page,status,created_at";
  const rows = await db
    .prepare(
      `SELECT ${columns} FROM "AppFeedback"
       WHERE user_id=?1 AND family_id=?2
       ORDER BY created_at DESC,id ASC LIMIT 25`,
    )
    .bind(actor.userId, actor.familyId)
    .all<FeedbackRow>();
  return {
    status: 200,
    body: {
      reports: rows.results.map((row) =>
        summaryOnly ? summary(row) : report(row),
      ),
    },
  };
}

/** Save one private report with the same request-id deduplication contract as PostgreSQL. */
export async function saveD1Feedback(
  actor: D1FeedbackActor,
  input: {
    requestId: string;
    kind: string;
    title: string;
    details: string;
    page: string;
  },
  summaryOnly: boolean,
  database?: D1Store,
): Promise<EffectResult> {
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  const inserted = await db
    .prepare(
      `INSERT INTO "AppFeedback"
        (id,user_id,family_id,request_id,kind,title,details,page,status,created_at)
       SELECT lower(hex(randomblob(16))),?1,?2,?3,?4,?5,?6,?7,'received',?8
       WHERE EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND token_version=?9)
       ON CONFLICT(user_id,request_id) DO NOTHING
       RETURNING id,user_id,family_id,request_id,kind,title,details,page,status,created_at`,
    )
    .bind(
      actor.userId,
      actor.familyId,
      input.requestId,
      input.kind,
      input.title,
      input.details,
      input.page,
      Date.now(),
      actor.generation,
    )
    .first<FeedbackRow>();

  if (inserted) {
    return {
      status: 201,
      body: { report: summaryOnly ? summary(inserted) : report(inserted) },
    };
  }

  const existing = await db
    .prepare(
      `SELECT id,user_id,family_id,request_id,kind,title,details,page,status,created_at
       FROM "AppFeedback" WHERE user_id=?1 AND request_id=?2`,
    )
    .bind(actor.userId, input.requestId)
    .first<FeedbackRow>();
  const current = await currentActor(db, actor);
  if (!authorized(current, actor))
    return { status: 401, body: { error: "Unauthorized" } };
  if (!existing)
    return { status: 409, body: { error: "Report could not be saved" } };
  if (existing.family_id !== actor.familyId)
    return { status: 404, body: { error: "Report not found" } };
  if (
    existing.kind !== input.kind ||
    existing.title !== input.title ||
    existing.details !== input.details ||
    existing.page !== input.page
  )
    return {
      status: 409,
      body: {
        error:
          "This request ID belongs to a different report. Review your draft before sending a new report.",
        code: "REPORT_REQUEST_CONFLICT",
      },
    };
  return {
    status: 201,
    body: { report: summaryOnly ? summary(existing) : report(existing) },
  };
}
