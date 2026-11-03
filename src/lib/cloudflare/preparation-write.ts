/** One native batch commits canonical chores, preparation links and the receipt.
 * The shared planner decides effects; captured source reads guard every effect.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hashIdempotentRequest } from "../idempotency-hash";
import {
  EVENT_PREPARATION_PROTOCOL,
  EventPreparationError,
  preparationCommand,
  planEventPreparation,
} from "../event-preparation/contract";
import {
  PREPARATION_ACTION,
  preparationReceipt,
} from "../event-preparation/http";
import { preparationReceiptMatches } from "../event-preparation/receipt-server";
import { scopeForPreparationCommand } from "../event-preparation/read-contract";
import { eventPreparationWritingEnabled } from "../event-preparation/owner";
import {
  preparationCopyFactId,
  preparationOriginFact,
  PREPARATION_COPY_ACTION,
} from "../event-preparation/origin";
import type { PreparationActor } from "../event-preparation/runtime";
import { getD1Database, type D1Store, type D1Statement } from "./database";
import { executeD1PersonEffect } from "./person-effect";
import {
  authorizeD1PreparationActor,
  loadD1PreparationSource,
} from "./preparation-source";
import { d1EventPreparationStorageAvailable } from "./chore-read-policy";

export async function writeD1EventPreparation(
  actor: PreparationActor,
  raw: unknown,
  key: string,
  database?: D1Store,
  now = new Date(),
) {
  const command = preparationCommand.parse(raw);
  z.string()
    .regex(/^[A-Za-z0-9_-]{16,128}$/)
    .parse(key);
  if (
    command.owner.userId !== actor.userId ||
    command.owner.familyId !== actor.familyId
  )
    throw new EventPreparationError("FORBIDDEN");
  const store = database ?? (await getD1Database());
  const result = await executeD1PersonEffect({
    actor: {
      userId: actor.userId,
      familyId: actor.familyId,
      generation: actor.tokenVersion,
      role: "parent",
    },
    action: PREPARATION_ACTION,
    input: command,
    key,
    database: store,
    now,
    authorize: async (db) => {
      await authorizeD1PreparationActor(db, actor);
      return null;
    },
    plan: async (db) => {
      // Completed receipts can replay after a pause or target deletion; only new
      // effects require the feature and current storage readiness.
      if (
        !eventPreparationWritingEnabled() ||
        !(await d1EventPreparationStorageAvailable(store))
      )
        throw new EventPreparationError("UNAVAILABLE");
      const prepared = await loadD1PreparationSource(
        db,
        actor,
        scopeForPreparationCommand(command),
      );
      const effect = planEventPreparation(command, prepared.context, now);
      const created = effect.create.map((step) => ({
        step,
        choreId: randomUUID(),
      }));
      const planId = effect.ordered.length
        ? (prepared.state?.id ?? randomUUID())
        : null;
      const body = preparationReceipt.parse({
        receipt: {
          protocol: EVENT_PREPARATION_PROTOCOL,
          userId: actor.userId,
          familyId: actor.familyId,
          eventId: command.eventId,
          action: command.action,
          requestKey: key,
          requestHash: hashIdempotentRequest(PREPARATION_ACTION, command),
          sourceToken: command.eventSourceToken,
          expectedToken: command.expectedToken,
          planId,
          createdCount: created.length,
        },
      });
      return {
        status: 200,
        body,
        effects: (session) => {
          const statements: D1Statement[] = [];
          for (const change of effect.retime)
            statements.push(
              session
                .prepare(
                  `UPDATE Chore SET due_date=? WHERE id=? AND family_id=?`,
                )
                .bind(
                  Date.parse(`${change.to}T00:00:00.000Z`),
                  change.choreId,
                  actor.familyId,
                ),
            );
          for (const { step, choreId } of created) {
            statements.push(
              session
                .prepare(
                  `INSERT INTO Chore (id,family_id,created_by,title,description,points,assigned_to,assigned_member_id,due_date,status,frequency,is_template,difficulty,icon,routine_duration_minutes) VALUES (?,?,?,?,?,?,?,?,?,'pending','once',0,?,?,?)`,
                )
                .bind(
                  choreId,
                  actor.familyId,
                  actor.userId,
                  step.title,
                  step.description,
                  step.points,
                  step.subject.kind === "account"
                    ? step.subject.accountId
                    : null,
                  step.subject.kind === "profile"
                    ? step.subject.memberId
                    : null,
                  Date.parse(`${step.dueDay}T00:00:00.000Z`),
                  step.difficulty,
                  step.icon,
                  step.durationMinutes,
                ),
            );
            if (step.origin)
              statements.push(
                session
                  .prepare(
                    `INSERT INTO Activity (id,family_id,user_id,type,title,metadata,created_at) VALUES (?,?,?,?,?,?,?)`,
                  )
                  .bind(
                    preparationCopyFactId(actor.familyId, choreId),
                    actor.familyId,
                    actor.userId,
                    PREPARATION_COPY_ACTION,
                    "Routine step copied for preparation",
                    JSON.stringify(
                      preparationOriginFact.parse({
                        timeline: 1,
                        actorKind: "person",
                        target: { kind: "chore", id: choreId },
                        routineCopy: step.origin,
                      }),
                    ),
                    now.getTime(),
                  ),
              );
          }
          if (!planId && prepared.state)
            statements.push(
              session
                .prepare(
                  `DELETE FROM EventPreparation WHERE id=? AND family_id=? AND event_id=?`,
                )
                .bind(prepared.state.id, actor.familyId, command.eventId),
            );
          if (planId) {
            if (prepared.state) {
              statements.push(
                session
                  .prepare(
                    `UPDATE EventPreparation SET reviewed_event_source=? WHERE id=? AND family_id=? AND event_id=?`,
                  )
                  .bind(
                    effect.reviewedEventSourceToken,
                    planId,
                    actor.familyId,
                    command.eventId,
                  ),
              );
              // D1 has immediate unique-position constraints. Reinsert retained
              // identities in the same batch, never expose temporary positions.
              statements.push(
                session
                  .prepare(
                    `DELETE FROM EventPreparationStep WHERE preparation_id=? AND family_id=?`,
                  )
                  .bind(planId, actor.familyId),
              );
            } else
              statements.push(
                session
                  .prepare(
                    `INSERT INTO EventPreparation (id,family_id,event_id,reviewed_event_source) VALUES (?,?,?,?)`,
                  )
                  .bind(
                    planId,
                    actor.familyId,
                    command.eventId,
                    effect.reviewedEventSourceToken,
                  ),
              );
            for (const [index, step] of effect.ordered.entries()) {
              const choreId =
                step.kind === "existing"
                  ? step.choreId
                  : created.find((row) => row.step.clientId === step.clientId)
                      ?.choreId;
              if (!choreId) throw new EventPreparationError("UNAVAILABLE");
              const id =
                prepared.state?.links.find((link) => link.choreId === choreId)
                  ?.id ?? randomUUID();
              statements.push(
                session
                  .prepare(
                    `INSERT INTO EventPreparationStep (id,family_id,preparation_id,chore_id,position,cue_anchor,cue_direction,cue_minutes) VALUES (?,?,?,?,?,?,?,?)`,
                  )
                  .bind(
                    id,
                    actor.familyId,
                    planId,
                    choreId,
                    index + 1,
                    step.cue?.anchor ?? null,
                    step.cue?.direction ?? null,
                    step.cue?.minutes ?? null,
                  ),
              );
            }
          }
          if (planId || prepared.state || created.length)
            statements.push(
              session
                .prepare(
                  `INSERT INTO Activity (id,family_id,user_id,type,title,metadata,created_at) VALUES (?,?,?,'preparation_changed','Household record changed',?,?)`,
                )
                .bind(
                  randomUUID(),
                  actor.familyId,
                  actor.userId,
                  JSON.stringify({
                    timeline: 1,
                    actorKind: "person",
                    target: { kind: "event", id: command.eventId },
                  }),
                  now.getTime(),
                ),
            );
          return statements;
        },
      };
    },
  });
  if (
    result.status !== 200 ||
    !preparationReceiptMatches(result.body, command, key)
  )
    throw new EventPreparationError("UNSUPPORTED");
  return { ...result, body: preparationReceipt.parse(result.body) };
}
