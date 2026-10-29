/** Native D1 pickup reads and household-scoped effects.
 *
 * Pickups are intentionally a shared family surface: any current family
 * member may read, create, and mark one complete; only a parent may delete.
 * Every response and effect is scoped by the authenticated family and token
 * generation so a stale or cross-household actor cannot retain access.
 */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "../idempotency";
import { isFeatureEnabled, normalizeFeatures } from "../features";
import { createPickupSchema } from "../validations";
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

export type D1PickupActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};

type PickupInput = ReturnType<typeof createPickupSchema.parse>;

const failure = (status: number, error: string): EffectResult => ({
  status,
  body: { error },
});

function storedFeatures(value: unknown) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  return normalizeFeatures(value);
}

function iso(value: unknown): string | null {
  const date = value instanceof Date ? value : new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

type PickupFields = {
  id: string;
  family_id: string;
  title: string;
  location: string | null;
  pickup_time: unknown;
  assigned_to: string | null;
  created_by: string;
  notes: string | null;
  completed: boolean | number;
  completed_at: unknown;
  created_at: unknown;
  updated_at: unknown;
};

function pickupDto(row: PickupFields) {
  return {
    id: row.id,
    title: row.title,
    location: row.location,
    pickup_time: iso(row.pickup_time),
    assigned_to: row.assigned_to,
    created_by: row.created_by,
    notes: row.notes,
    completed: Boolean(row.completed),
    completed_at: iso(row.completed_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

async function authority(
  db: D1ReadClient,
  actor: D1PickupActor,
  mutation: "read" | "add" | "update" | "delete",
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
  if (!family || !isFeatureEnabled(storedFeatures(family.features), "pickups"))
    return failure(403, "This feature is turned off for your family");
  if (!(
    actor.role === "parent" ||
    actor.role === "teen" ||
    actor.role === "child"
  ))
    return failure(403, "Only family members can use pickups");
  if (mutation === "delete" && actor.role !== "parent")
    return failure(403, "Parents only");
  return null;
}

function readFields(prefix = "p.") {
  return `${prefix}id,${prefix}family_id,${prefix}title,${prefix}location,${prefix}pickup_time,${prefix}assigned_to,${prefix}created_by,${prefix}notes,${prefix}completed,${prefix}completed_at,${prefix}created_at,${prefix}updated_at`;
}

export async function readD1Pickups(
  actor: D1PickupActor,
  database?: D1Store,
): Promise<EffectResult> {
  const store = database ?? (await getD1Database());
  const denied = await withD1ReadClient(
    (db) => authority(db, actor, "read"),
    store as unknown as NativeD1,
  );
  if (denied) return denied;
  const rows = await store
    .withSession("first-primary")
    .prepare(
      `SELECT ${readFields()},u.name AS assignee_name,u.avatar_url AS assignee_avatar
         FROM "Pickup" p
         LEFT JOIN "User" u ON u.id=p.assigned_to AND u.family_id=p.family_id
        WHERE p.family_id=?1
        ORDER BY p.pickup_time ASC,p.id ASC`,
    )
    .bind(actor.familyId)
    .all<
      PickupFields & {
        assignee_name: string | null;
        assignee_avatar: string | null;
      }
    >();
  return {
    status: 200,
    body: {
      pickups: rows.results.map((row) => ({
        ...pickupDto(row),
        assignee_name: row.assignee_name,
        assignee_avatar: row.assignee_avatar,
      })),
    },
  };
}

function writeChecks(
  session: Pick<D1Store, "prepare">,
  actor: D1PickupActor,
  mutation: "add" | "update" | "delete",
  id?: string,
  assignedTo?: string | null,
) {
  const checks = [
    d1WriteCheck(
      session,
      `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role=?3 AND token_version=?4)`,
      [actor.userId, actor.familyId, actor.role, actor.generation],
    ),
    d1WriteCheck(
      session,
      `EXISTS (SELECT 1 FROM "Family" WHERE id=?1 AND json_extract(features,'$.pickups')=1)`,
      [actor.familyId],
    ),
  ];
  if (mutation === "delete")
    checks.push(
      d1WriteCheck(
        session,
        `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`,
        [actor.userId, actor.familyId, actor.generation],
      ),
    );
  if (id)
    checks.push(
      d1WriteCheck(
        session,
        `EXISTS (SELECT 1 FROM "Pickup" WHERE id=?1 AND family_id=?2)`,
        [id, actor.familyId],
      ),
    );
  if (assignedTo)
    checks.push(
      d1WriteCheck(
        session,
        `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role IN ('parent','teen','child'))`,
        [assignedTo, actor.familyId],
      ),
    );
  return checks;
}

export function createD1Pickup(
  actor: D1PickupActor,
  input: PickupInput,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: "pickup.create",
    input,
    key: null,
    database,
    authorize: (db) => authority(db, actor, "add"),
    plan: async (db) => {
      if (input.assigned_to) {
        const assignee = await db.user.findFirst({
          where: {
            id: input.assigned_to,
            family_id: actor.familyId,
            role: { in: ["parent", "teen", "child"] },
          },
          select: { id: true },
        });
        if (!assignee)
          return failure(400, "Assignee must be a member of your family");
      }
      const id = randomUUID();
      const now = Date.now();
      const pickup = {
        id,
        family_id: actor.familyId,
        title: input.title,
        location: input.location?.trim() || null,
        pickup_time: new Date(input.pickup_time).toISOString(),
        assigned_to: input.assigned_to || null,
        created_by: actor.userId,
        notes: input.notes?.trim() || null,
        completed: false,
        completed_at: null,
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      };
      return {
        status: 201,
        body: { pickup },
        effects: (session: Pick<D1Store, "prepare">) => [
          ...writeChecks(session, actor, "add", undefined, input.assigned_to),
          session
            .prepare(
              `INSERT INTO "Pickup"(id,family_id,title,location,pickup_time,assigned_to,created_by,notes,completed,completed_at,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,NULL,?9,?9)`,
            )
            .bind(
              id,
              actor.familyId,
              input.title,
              input.location?.trim() || null,
              Date.parse(input.pickup_time),
              input.assigned_to || null,
              actor.userId,
              input.notes?.trim() || null,
              now,
            ),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}

export function updateD1Pickup(
  actor: D1PickupActor,
  id: string,
  completed: boolean | undefined,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: "pickup.update",
    input: { id, completed },
    key: null,
    database,
    authorize: (db) => authority(db, actor, "update"),
    plan: async (db) => {
      const row = await db.pickup.findFirst({
        where: { id, family_id: actor.familyId },
      });
      if (!row) return failure(404, "Not found");
      const nextCompleted = completed === undefined ? row.completed : completed;
      const nextCompletedAt =
        completed === undefined
          ? row.completed_at
          : completed
            ? new Date()
            : null;
      const now = Date.now();
      const pickup = {
        id: row.id,
        family_id: row.family_id,
        title: row.title,
        location: row.location,
        pickup_time: new Date(row.pickup_time).toISOString(),
        assigned_to: row.assigned_to,
        created_by: row.created_by,
        notes: row.notes,
        completed: Boolean(nextCompleted),
        completed_at: nextCompletedAt
          ? new Date(nextCompletedAt).toISOString()
          : null,
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(now).toISOString(),
      };
      return {
        status: 200,
        body: { pickup },
        effects: (session: Pick<D1Store, "prepare">) => [
          ...writeChecks(session, actor, "update", id),
          session
            .prepare(
              `UPDATE "Pickup" SET completed=?1,completed_at=?2,updated_at=?3 WHERE id=?4 AND family_id=?5`,
            )
            .bind(
              Number(Boolean(nextCompleted)),
              nextCompletedAt ? new Date(nextCompletedAt).getTime() : null,
              now,
              id,
              actor.familyId,
            ),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}

export function deleteD1Pickup(
  actor: D1PickupActor,
  id: string,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: "pickup.delete",
    input: { id },
    key: null,
    database,
    authorize: (db) => authority(db, actor, "delete"),
    plan: async (db) => {
      const row = await db.pickup.findFirst({
        where: { id, family_id: actor.familyId },
        select: { id: true },
      });
      if (!row) return failure(404, "Not found");
      return {
        status: 200,
        body: { ok: true },
        effects: (session: Pick<D1Store, "prepare">) => [
          ...writeChecks(session, actor, "delete", id),
          session
            .prepare(`DELETE FROM "Pickup" WHERE id=?1 AND family_id=?2`)
            .bind(id, actor.familyId),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}
