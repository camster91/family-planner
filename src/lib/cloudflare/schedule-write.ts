/** Native event move and receipt commit together; the complete compared source
 * is rechecked in that same batch, including newly inserted conflicts. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ScheduleReviewError,
  scheduleMoveCommand,
  SCHEDULE_REVIEW_PROTOCOL,
} from "../calendar-planning/conflict-review";
import {
  SCHEDULE_ACTION,
  scheduleReceipt,
  scheduleReceiptMatches,
} from "../calendar-planning/schedule-http";
import {
  requireScheduleOwner,
  requireScheduleMove,
  scopeForScheduleCommand,
  type ScheduleActor,
} from "../calendar-planning/schedule-runtime";
import { scheduleReviewWritingEnabled } from "../calendar-planning/schedule-owner";
import { getD1Database, type D1Store } from "./database";
import { executeD1PersonEffect } from "./person-effect";
import {
  authorizeD1ScheduleActor,
  captureD1ScheduleSource,
} from "./schedule-source";
export async function writeD1ScheduleMove(
  actor: ScheduleActor,
  raw: unknown,
  key: string,
  database?: D1Store,
  now = new Date(),
) {
  const command = scheduleMoveCommand.parse(raw);
  z.string()
    .regex(/^[A-Za-z0-9_-]{16,128}$/)
    .parse(key);
  requireScheduleOwner(command, actor);
  const store = database ?? (await getD1Database());
  const result = await executeD1PersonEffect({
    actor: {
      userId: actor.userId,
      familyId: actor.familyId,
      generation: actor.tokenVersion,
      role: "parent",
    },
    action: SCHEDULE_ACTION,
    input: command,
    key,
    database: store,
    now,
    authorize: async (db) => {
      await authorizeD1ScheduleActor(db, actor);
      return null;
    },
    plan: async (db) => {
      const current = await authorizeD1ScheduleActor(db, actor);
      if (
        !scheduleReviewWritingEnabled() ||
        current.role !== "parent" ||
        !current.calendarEnabled
      )
        throw new ScheduleReviewError("FORBIDDEN");
      const capture = await captureD1ScheduleSource(
        actor,
        scopeForScheduleCommand(command),
        store,
        now,
      );
      requireScheduleMove(capture.prepared.snapshot, command, now);
      const body = scheduleReceipt.parse({
        receipt: {
          protocol: SCHEDULE_REVIEW_PROTOCOL,
          userId: actor.userId,
          familyId: actor.familyId,
          targetId: command.target.id,
          requestKey: key,
          action: command.action,
          sourceToken: command.target.sourceToken,
          snapshotToken: command.snapshotToken,
          start: command.start,
          end: command.end,
        },
      });
      return {
        status: 200,
        body,
        effects: (session) => [
          ...capture.checks(session),
          session
            .prepare(
              `UPDATE Event SET start_time=?,end_time=?,updated_at=? WHERE id=? AND family_id=?`,
            )
            .bind(
              Date.parse(command.start),
              Date.parse(command.end),
              now.getTime(),
              command.target.id,
              actor.familyId,
            ),
          session
            .prepare(
              `INSERT INTO Activity (id,family_id,user_id,type,title,metadata,created_at) VALUES (?,?,?,'schedule_changed','Household record changed',?,?)`,
            )
            .bind(
              randomUUID(),
              actor.familyId,
              actor.userId,
              JSON.stringify({
                timeline: 1,
                actorKind: "person",
                target: { kind: "event", id: command.target.id },
              }),
              now.getTime(),
            ),
        ],
      };
    },
  });
  if (
    result.status !== 200 ||
    !scheduleReceiptMatches(result.body, command, key)
  )
    throw new ScheduleReviewError("UNSUPPORTED");
  return { ...result, body: scheduleReceipt.parse(result.body) };
}
