/** Native D1 bridge for the review-first calendar import commit/undo flow. */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import { EVENT_IMPORT_MAX_SUGGESTIONS, EVENT_IMPORT_UNDO_WINDOW_MS } from "@/lib/event-import";
import {
  EVENT_IMPORT_ACTIVITY_TYPE,
  EVENT_IMPORT_COMMIT_ACTION,
  type CommitActor,
  type CommitInput,
  signUndoToken,
  verifyUndoToken,
} from "@/lib/event-import-commit";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/feature-flags";
import {
  executeD1PersonEffect,
  type NativePersonResult,
} from "./person-effect";
import { d1WriteCheck } from "./write-check";
import { getD1Database, type D1Store } from "./database";
import type { D1ReadClient } from "./read-client";

type D1CalendarImportActor = {
  userId: string;
  familyId: string;
  generation: number;
  role: string;
  name: string;
};

const failure = (status: number, error: string): EffectResult => ({
  status,
  body: { error },
});

function responseFor(
  actor: CommitActor,
  eventIds: string[],
  createdAt: number,
) {
  return {
    eventIds,
    count: eventIds.length,
    undoToken: signUndoToken({
      userId: actor.id,
      familyId: actor.family_id,
      eventIds,
      createdAt,
    }),
    undoExpiresAt: new Date(
      createdAt + EVENT_IMPORT_UNDO_WINDOW_MS,
    ).toISOString(),
  };
}

async function authorizeD1CalendarImport(
  db: D1ReadClient,
  actor: D1CalendarImportActor,
) {
  const [user, family] = await Promise.all([
    db.user.findUnique({
      where: { id: actor.userId },
      select: { family_id: true, role: true, token_version: true },
    }),
    db.family.findUnique({
      where: { id: actor.familyId },
      select: { id: true, features: true },
    }),
  ]);
  if (
    !user ||
    user.family_id !== actor.familyId ||
    user.role !== actor.role ||
    user.token_version !== actor.generation
  )
    return failure(401, "Unauthorized");
  if (!['parent', 'teen'].includes(user.role))
    return failure(403, "EVENT_IMPORT_FORBIDDEN");
  if (
    !family ||
    !isFeatureEnabled(normalizeFeatures(family.features), "calendar")
  )
    return failure(403, "This feature is turned off for your family");
  return null;
}

/** Commit reviewed events and the import receipt in one native D1 batch. */
export async function commitD1ImportedEvents(
  actor: D1CalendarImportActor,
  input: CommitInput,
  key: string,
  database?: D1Store,
  now = new Date(),
): Promise<NativePersonResult> {
  if (!key || input.events.length < 1 || input.events.length > EVENT_IMPORT_MAX_SUGGESTIONS)
    return { status: 400, body: { error: "INVALID_BODY" }, replayed: false };
  const createdAt = now.getTime();
  return executeD1PersonEffect({
    actor,
    action: EVENT_IMPORT_COMMIT_ACTION,
    input,
    key,
    database,
    now,
    authorize: db => authorizeD1CalendarImport(db, actor),
    plan: async (_db, receiptId) => {
      const eventIds = input.events.map(() => randomUUID());
      const body = responseFor(
        { id: actor.userId, family_id: actor.familyId, name: actor.name },
        eventIds,
        createdAt,
      );
      return {
        status: 201,
        body,
        effects: session => [
          ...input.events.map((event, index) => {
            const start = new Date(event.start_time);
            const end = new Date(event.end_time ?? event.start_time);
            return session
              .prepare(
                `INSERT INTO "Event"(id,family_id,created_by,title,description,location,start_time,end_time,event_type,recurrence,created_at,updated_at,schedule_generation)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'other',NULL,?9,?9,?10)`,
              )
              .bind(
                eventIds[index],
                actor.familyId,
                actor.userId,
                event.title,
                event.description || null,
                event.location || null,
                start.getTime(),
                end.getTime(),
                createdAt,
                randomUUID(),
              );
          }),
          session
            .prepare(
              `INSERT INTO "Activity"(id,family_id,user_id,type,title,metadata,created_at)
               VALUES(?1,?2,?3,?4,?5,?6,?7)`,
            )
            .bind(
              randomUUID(),
              actor.familyId,
              actor.userId,
              EVENT_IMPORT_ACTIVITY_TYPE,
              `${actor.name} imported ${eventIds.length} event${eventIds.length === 1 ? "" : "s"} to the calendar`,
              JSON.stringify({ requestId: receiptId, eventIds, createdAt }),
              createdAt,
            ),
        ],
      };
    },
    effectChecks: async _store => ({
      checks: session => [
        d1WriteCheck(
          session,
          `EXISTS(SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id
            WHERE u.id=?1 AND u.family_id=?2 AND u.role=?3 AND u.token_version=?4
              AND COALESCE(json_extract(f.features,'$.calendar'),1)<>0)`,
          [actor.userId, actor.familyId, actor.role, actor.generation],
        ),
      ],
    }),
  });
}

/** Undo only the caller-owned, manually-created events named by a valid token. */
export async function undoD1ImportedEvents(
  actor: D1CalendarImportActor,
  token: string,
  database?: D1Store,
  now = Date.now(),
) {
  const check = verifyUndoToken(token, {
    userId: actor.userId,
    familyId: actor.familyId,
  }, now);
  if (!check.ok)
    return failure(
      check.reason === "expired" ? 409 : 403,
      check.reason === "expired" ? "UNDO_WINDOW_EXPIRED" : "UNDO_TOKEN_INVALID",
    );
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  const authority = await db
    .prepare(
      `SELECT u.family_id,u.role,u.token_version,f.features
       FROM "User" u JOIN "Family" f ON f.id=u.family_id WHERE u.id=?1`,
    )
    .bind(actor.userId)
    .first<{
      family_id: string | null;
      role: string;
      token_version: number;
      features: string | null;
    }>();
  if (
    !authority ||
    authority.family_id !== actor.familyId ||
    authority.role !== actor.role ||
    authority.token_version !== actor.generation
  )
    return failure(401, "Unauthorized");
  if (!['parent', 'teen'].includes(authority.role))
    return failure(403, "EVENT_IMPORT_FORBIDDEN");
  if (!isFeatureEnabled(normalizeFeatures(authority.features), "calendar"))
    return failure(403, "This feature is turned off for your family");

  const placeholders = check.eventIds.map((_, index) => `?${index + 1}`);
  const familyIndex = check.eventIds.length + 1;
  const userIndex = familyIndex + 1;
  const result = await db.batch([
    d1WriteCheck(
      db,
      `EXISTS(SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id
        WHERE u.id=?${userIndex} AND u.family_id=?${familyIndex}
          AND u.role=?${userIndex + 1} AND u.token_version=?${userIndex + 2}
          AND COALESCE(json_extract(f.features,'$.calendar'),1)<>0)`,
      [...check.eventIds, actor.familyId, actor.userId, actor.role, actor.generation],
    ),
    db
      .prepare(
        `DELETE FROM "Event"
         WHERE id IN (${placeholders.join(",")})
           AND family_id=?${familyIndex} AND created_by=?${userIndex}
           AND source_subscription_id IS NULL AND source_connection_id IS NULL`,
      )
      .bind(...check.eventIds, actor.familyId, actor.userId),
  ]);
  return { status: 200, body: { removedCount: result[1].meta.changes } };
}
