/** Native D1 sitter handoffs.
 *
 * Handoffs contain household-sensitive notes and an unauthenticated bearer
 * token.  Reads therefore validate the current session before selecting a
 * family, while writes use the person-effect receipt coordinator and recheck
 * the current responsibility source in the atomic D1 batch.  The public
 * token reader is deliberately separate: it only selects the allowlisted
 * sitter-facing fields and fails closed for stale/legacy links.
 */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { shapeHandoffForRole } from "@/lib/role-capabilities";
import { shareExpiry } from "@/lib/handoff-share";
import type {
  createHandoffSchema,
  updateHandoffSchema,
} from "@/lib/validations";
import {
  executeD1PersonEffect,
  type NativePersonResult,
} from "./person-effect";
import { getD1Database, type D1Store } from "./database";
import {
  withD1ReadClient,
  type D1ReadClient,
  type NativeD1,
} from "./read-client";
import { d1WriteCheck } from "./write-check";

export type D1HandoffActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};

type HandoffCreateInput = ReturnType<typeof createHandoffSchema.parse>;
type HandoffUpdateInput = ReturnType<typeof updateHandoffSchema.parse>;
type NativeResult = EffectResult & { replayed?: boolean };

const failure = (status: number, error: string): EffectResult => ({
  status,
  body: { error },
});

function storedFeatures(value: unknown) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = {};
    }
  }
  return normalizeFeatures(value);
}

function dateValue(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function dateMs(value: unknown): number | null {
  const date = dateValue(value);
  return date ? date.getTime() : null;
}

function token() {
  return randomUUID().replaceAll("-", "");
}

type HandoffRow = {
  responsibility_generation: string;
  responsibility_epoch: number;
  id: string;
  family_id: string;
  sitter_name: string;
  sitter_phone: string | null;
  arrival_time: unknown;
  departure_time: unknown;
  kids_bedtimes: string | null;
  where_snacks: string | null;
  pickup_authorized: string | null;
  code_words: string | null;
  pet_care: string | null;
  emergency_notes: string | null;
  house_notes: string | null;
  general_notes: string | null;
  share_token: string;
  share_expires_at: unknown;
  created_by: string;
  created_at: unknown;
  updated_at: unknown;
};

function handoffDto(row: HandoffRow) {
  return {
    responsibility_generation: row.responsibility_generation,
    responsibility_epoch: row.responsibility_epoch,
    id: row.id,
    family_id: row.family_id,
    sitter_name: row.sitter_name,
    sitter_phone: row.sitter_phone ?? null,
    arrival_time: dateValue(row.arrival_time),
    departure_time: dateValue(row.departure_time),
    kids_bedtimes: row.kids_bedtimes ?? null,
    where_snacks: row.where_snacks ?? null,
    pickup_authorized: row.pickup_authorized ?? null,
    code_words: row.code_words ?? null,
    pet_care: row.pet_care ?? null,
    emergency_notes: row.emergency_notes ?? null,
    house_notes: row.house_notes ?? null,
    general_notes: row.general_notes ?? null,
    share_token: row.share_token,
    share_expires_at: dateValue(row.share_expires_at),
    created_by: row.created_by,
    created_at: dateValue(row.created_at),
    updated_at: dateValue(row.updated_at),
  };
}

async function authority(
  db: D1ReadClient,
  actor: D1HandoffActor,
  mutation: "read" | "add" | "update" | "delete" | "rotate",
): Promise<EffectResult | null> {
  const [user, family] = await Promise.all([
    db.user.findUnique({
      where: { id: actor.userId },
      select: { family_id: true, role: true, token_version: true },
    }),
    db.family.findUnique({
      where: { id: actor.familyId },
      select: { features: true },
    }),
  ]);
  if (
    !user ||
    user.family_id !== actor.familyId ||
    user.role !== actor.role ||
    user.token_version !== actor.generation
  )
    return failure(401, "Unauthorized");
  if (!family || !isFeatureEnabled(storedFeatures(family.features), "handoff"))
    return failure(403, "This feature is turned off for your family");
  if (mutation !== "read" && actor.role !== "parent")
    return failure(403, "Only parents can perform this action");
  if (!["parent", "teen", "child"].includes(actor.role))
    return failure(403, "Only family members can use handoffs");
  return null;
}

function actorChecks(session: Pick<D1Store, "prepare">, actor: D1HandoffActor) {
  return [
    d1WriteCheck(
      session,
      `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role=?3 AND token_version=?4)`,
      [actor.userId, actor.familyId, actor.role, actor.generation],
    ),
    d1WriteCheck(
      session,
      `EXISTS (SELECT 1 FROM "Family" WHERE id=?1 AND json_extract(features,'$.handoff')=1)`,
      [actor.familyId],
    ),
    d1WriteCheck(
      session,
      `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`,
      [actor.userId, actor.familyId, actor.generation],
    ),
  ];
}

export async function readD1Handoffs(
  actor: D1HandoffActor,
  database?: D1Store,
): Promise<NativeResult> {
  const store = database ?? (await getD1Database());
  const denied = await withD1ReadClient(
    (db) => authority(db, actor, "read"),
    store as unknown as NativeD1,
  );
  if (denied) return denied;
  const rows = await store
    .withSession("first-primary")
    .prepare(
      `SELECT h.* FROM "Handoff" h WHERE h.family_id=?1 ORDER BY h.created_at DESC,h.id ASC`,
    )
    .bind(actor.familyId)
    .all<HandoffRow>();
  return {
    status: 200,
    body: {
      handoffs: rows.results.map((row) =>
        shapeHandoffForRole(handoffDto(row), actor.role),
      ),
    },
  };
}

export function createD1Handoff(
  actor: D1HandoffActor,
  input: HandoffCreateInput,
  key: string | null,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: "handoff.create",
    input,
    key,
    database,
    authorize: (db) => authority(db, actor, "add"),
    plan: async () => {
      const arrival = dateMs(input.arrival_time);
      const departure = dateMs(input.departure_time);
      if (input.arrival_time != null && arrival == null)
        return failure(
          400,
          "Invalid arrival_time format. Use the date/time picker.",
        );
      if (input.departure_time != null && departure == null)
        return failure(
          400,
          "Invalid departure_time format. Use the date/time picker.",
        );
      const now = Date.now();
      const id = randomUUID();
      const generation = randomUUID();
      const shareToken = token();
      const expires = shareExpiry(
        departure == null ? null : new Date(departure),
        now,
      ).getTime();
      const row: HandoffRow = {
        responsibility_generation: generation,
        responsibility_epoch: 0,
        id,
        family_id: actor.familyId,
        sitter_name: input.sitter_name,
        sitter_phone: input.sitter_phone?.trim() || null,
        arrival_time: arrival,
        departure_time: departure,
        kids_bedtimes: input.kids_bedtimes?.trim() || null,
        where_snacks: input.where_snacks?.trim() || null,
        pickup_authorized: input.pickup_authorized?.trim() || null,
        code_words: input.code_words?.trim() || null,
        pet_care: input.pet_care?.trim() || null,
        emergency_notes: input.emergency_notes?.trim() || null,
        house_notes: input.house_notes?.trim() || null,
        general_notes: input.general_notes?.trim() || null,
        share_token: shareToken,
        share_expires_at: expires,
        created_by: actor.userId,
        created_at: now,
        updated_at: now,
      };
      return {
        status: 201,
        body: { handoff: handoffDto(row) },
        effects: (session) => [
          ...actorChecks(session, actor),
          session
            .prepare(
              `INSERT INTO "Handoff"(responsibility_generation,responsibility_epoch,id,family_id,sitter_name,sitter_phone,arrival_time,departure_time,kids_bedtimes,where_snacks,pickup_authorized,code_words,pet_care,emergency_notes,house_notes,general_notes,share_token,share_expires_at,created_by,created_at,updated_at)
               VALUES (?1,0,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?19)`,
            )
            .bind(
              generation,
              id,
              actor.familyId,
              row.sitter_name,
              row.sitter_phone,
              arrival,
              departure,
              row.kids_bedtimes,
              row.where_snacks,
              row.pickup_authorized,
              row.code_words,
              row.pet_care,
              row.emergency_notes,
              row.house_notes,
              row.general_notes,
              shareToken,
              expires,
              actor.userId,
              now,
            ),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}

export function updateD1Handoff(
  actor: D1HandoffActor,
  id: string,
  input: HandoffUpdateInput,
  key: string | null,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: "handoff.update",
    input: { id, ...input },
    key,
    database,
    authorize: (db) => authority(db, actor, "update"),
    plan: async (db) => {
      const existing = await db.handoff.findFirst({
        where: { id, family_id: actor.familyId },
      });
      if (!existing) return failure(404, "Not found");
      const arrival =
        input.arrival_time === undefined
          ? dateMs(existing.arrival_time)
          : dateMs(input.arrival_time);
      const departure =
        input.departure_time === undefined
          ? dateMs(existing.departure_time)
          : dateMs(input.departure_time);
      if (
        input.arrival_time !== undefined &&
        input.arrival_time !== null &&
        arrival == null
      )
        return failure(400, "Invalid arrival_time format");
      if (
        input.departure_time !== undefined &&
        input.departure_time !== null &&
        departure == null
      )
        return failure(400, "Invalid departure_time format");
      const previousEpoch = existing.responsibility_epoch;
      const previousGeneration = existing.responsibility_generation;
      const now = Math.max(Date.now(), (dateMs(existing.updated_at) ?? 0) + 1);
      const next: HandoffRow = {
        ...(existing as unknown as HandoffRow),
        sitter_name:
          input.sitter_name === undefined
            ? existing.sitter_name
            : input.sitter_name,
        sitter_phone:
          input.sitter_phone === undefined
            ? existing.sitter_phone
            : input.sitter_phone?.trim() || null,
        arrival_time: arrival,
        departure_time: departure,
        kids_bedtimes:
          input.kids_bedtimes === undefined
            ? existing.kids_bedtimes
            : input.kids_bedtimes?.trim() || null,
        where_snacks:
          input.where_snacks === undefined
            ? existing.where_snacks
            : input.where_snacks?.trim() || null,
        pickup_authorized:
          input.pickup_authorized === undefined
            ? existing.pickup_authorized
            : input.pickup_authorized?.trim() || null,
        code_words:
          input.code_words === undefined
            ? existing.code_words
            : input.code_words?.trim() || null,
        pet_care:
          input.pet_care === undefined
            ? existing.pet_care
            : input.pet_care?.trim() || null,
        emergency_notes:
          input.emergency_notes === undefined
            ? existing.emergency_notes
            : input.emergency_notes?.trim() || null,
        house_notes:
          input.house_notes === undefined
            ? existing.house_notes
            : input.house_notes?.trim() || null,
        general_notes:
          input.general_notes === undefined
            ? existing.general_notes
            : input.general_notes?.trim() || null,
        updated_at: now,
      } as HandoffRow;
      const fields = [
        "sitter_name",
        "sitter_phone",
        "arrival_time",
        "departure_time",
        "kids_bedtimes",
        "where_snacks",
        "pickup_authorized",
        "code_words",
        "pet_care",
        "emergency_notes",
        "house_notes",
        "general_notes",
      ] as const;
      const assignments = fields
        .map((field, index) => `${field}=?${index + 3}`)
        .join(",");
      const values = fields.map((field) => (next as any)[field]);
      return {
        status: 200,
        body: { handoff: handoffDto(next) },
        effects: (session) => [
          ...actorChecks(session, actor),
          d1WriteCheck(
            session,
            `EXISTS (SELECT 1 FROM "Handoff" WHERE id=?1 AND family_id=?2 AND responsibility_generation=?3 AND responsibility_epoch=?4)`,
            [id, actor.familyId, previousGeneration, previousEpoch],
          ),
          session
            .prepare(
              `UPDATE "Handoff" SET ${assignments},updated_at=?${fields.length + 3} WHERE id=?1 AND family_id=?2 AND responsibility_generation=?${fields.length + 4} AND responsibility_epoch=?${fields.length + 5}`,
            )
            .bind(
              id,
              actor.familyId,
              ...values,
              now,
              previousGeneration,
              previousEpoch,
            ),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}

export function deleteD1Handoff(
  actor: D1HandoffActor,
  id: string,
  key: string | null,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: "handoff.delete",
    input: { id },
    key,
    database,
    authorize: (db) => authority(db, actor, "delete"),
    plan: async (db) => {
      const existing = await db.handoff.findFirst({
        where: { id, family_id: actor.familyId },
        select: { responsibility_generation: true, responsibility_epoch: true },
      });
      if (!existing) return failure(404, "Not found");
      return {
        status: 200,
        body: { success: true },
        effects: (session) => [
          ...actorChecks(session, actor),
          d1WriteCheck(
            session,
            `EXISTS (SELECT 1 FROM "Handoff" WHERE id=?1 AND family_id=?2 AND responsibility_generation=?3 AND responsibility_epoch=?4)`,
            [
              id,
              actor.familyId,
              existing.responsibility_generation,
              existing.responsibility_epoch,
            ],
          ),
          session
            .prepare(
              `DELETE FROM "Handoff" WHERE id=?1 AND family_id=?2 AND responsibility_generation=?3 AND responsibility_epoch=?4`,
            )
            .bind(
              id,
              actor.familyId,
              existing.responsibility_generation,
              existing.responsibility_epoch,
            ),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}

export function regenerateD1HandoffToken(
  actor: D1HandoffActor,
  id: string,
  key: string | null,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: "handoff.regenerate-token",
    input: { id },
    key,
    database,
    authorize: (db) => authority(db, actor, "rotate"),
    plan: async (db) => {
      const existing = await db.handoff.findFirst({
        where: { id, family_id: actor.familyId },
      });
      if (!existing) return failure(404, "Not found");
      const shareToken = token();
      const expires = shareExpiry(
        dateValue(existing.departure_time),
        Date.now(),
      ).getTime();
      const now = Math.max(Date.now(), (dateMs(existing.updated_at) ?? 0) + 1);
      const next = {
        ...(existing as any),
        share_token: shareToken,
        share_expires_at: expires,
        updated_at: now,
      } as HandoffRow;
      return {
        status: 200,
        body: { handoff: handoffDto(next) },
        effects: (session) => [
          ...actorChecks(session, actor),
          d1WriteCheck(
            session,
            `EXISTS (SELECT 1 FROM "Handoff" WHERE id=?1 AND family_id=?2 AND responsibility_generation=?3 AND responsibility_epoch=?4)`,
            [
              id,
              actor.familyId,
              existing.responsibility_generation,
              existing.responsibility_epoch,
            ],
          ),
          session
            .prepare(
              `UPDATE "Handoff" SET share_token=?3,share_expires_at=?4,updated_at=?5 WHERE id=?1 AND family_id=?2 AND responsibility_generation=?6 AND responsibility_epoch=?7`,
            )
            .bind(
              id,
              actor.familyId,
              shareToken,
              expires,
              now,
              existing.responsibility_generation,
              existing.responsibility_epoch,
            ),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}

/** Public token projection. No family feature flag is consulted: an already
 * issued link remains valid until its explicit expiry, while legacy/null
 * expiries fail closed. */
export async function readD1PublicHandoff(
  shareToken: string,
  database?: D1Store,
  now = Date.now(),
): Promise<NativeResult> {
  if (!shareToken || shareToken.length > 128) return failure(404, "Not found");
  const store = database ?? (await getD1Database());
  const row = await store
    .withSession("first-primary")
    .prepare(
      `SELECT h.id,h.sitter_name,h.sitter_phone,h.arrival_time,h.departure_time,h.kids_bedtimes,h.where_snacks,h.pickup_authorized,h.code_words,h.pet_care,h.emergency_notes,h.house_notes,h.general_notes,h.share_expires_at,f.name AS family_name
      FROM "Handoff" h JOIN "Family" f ON f.id=h.family_id
      WHERE h.share_token=?1`,
    )
    .bind(shareToken)
    .first<{
      id: string;
      sitter_name: string;
      sitter_phone: string | null;
      arrival_time: unknown;
      departure_time: unknown;
      kids_bedtimes: string | null;
      where_snacks: string | null;
      pickup_authorized: string | null;
      code_words: string | null;
      pet_care: string | null;
      emergency_notes: string | null;
      house_notes: string | null;
      general_notes: string | null;
      share_expires_at: unknown;
      family_name: string;
    }>();
  const expiry = dateMs(row?.share_expires_at);
  if (!row || expiry == null || expiry <= now) return failure(404, "Not found");
  return {
    status: 200,
    body: {
      handoff: {
        id: row.id,
        sitter_name: row.sitter_name,
        sitter_phone: row.sitter_phone ?? null,
        arrival_time: dateValue(row.arrival_time),
        departure_time: dateValue(row.departure_time),
        kids_bedtimes: row.kids_bedtimes ?? null,
        where_snacks: row.where_snacks ?? null,
        pickup_authorized: row.pickup_authorized ?? null,
        code_words: row.code_words ?? null,
        pet_care: row.pet_care ?? null,
        emergency_notes: row.emergency_notes ?? null,
        house_notes: row.house_notes ?? null,
        general_notes: row.general_notes ?? null,
        family: { name: row.family_name },
      },
    },
  };
}
