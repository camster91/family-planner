/** Native D1 private family-location reads and parent-only effects. */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "../idempotency";
import { isFeatureEnabled, normalizeFeatures } from "../features";
import { createLocationSchema } from "../validations";
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

export type D1LocationActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};
type LocationInput = ReturnType<typeof createLocationSchema.parse>;

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

async function authority(
  db: D1ReadClient,
  actor: D1LocationActor,
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
  if (actor.role !== "parent")
    return failure(
      403,
      mutation === "read"
        ? "Only parents can view locations"
        : `Only parents can ${mutation} locations`,
    );
  if (
    !family ||
    !isFeatureEnabled(storedFeatures(family.features), "locations")
  )
    return failure(403, "This feature is turned off for your family");
  return null;
}

function locationDto(row: {
  id: string;
  label: string;
  address: string | null;
  is_primary: boolean | number;
  user_id: string;
  user_name: string | null;
  user_avatar: string | null;
}) {
  return {
    id: row.id,
    label: row.label,
    address: row.address ?? null,
    is_primary: Boolean(row.is_primary),
    user_id: row.user_id,
    user_name: row.user_name,
    user_avatar: row.user_avatar,
  };
}

async function authorizedRead(actor: D1LocationActor, database?: D1Store) {
  const store = database ?? (await getD1Database());
  const denied = await withD1ReadClient(
    (db) => authority(db, actor, "read"),
    store as unknown as NativeD1,
  );
  if (denied) return { denied, store };
  return { denied: null, store };
}

export async function readD1Locations(
  actor: D1LocationActor,
  database?: D1Store,
): Promise<EffectResult> {
  const { denied, store } = await authorizedRead(actor, database);
  if (denied) return denied;
  const rows = await store
    .withSession("first-primary")
    .prepare(
      `SELECT l.id,l.label,l.address,l.is_primary,l.user_id,
              u.name AS user_name,u.avatar_url AS user_avatar
         FROM "FamilyLocation" l
         JOIN "User" u ON u.id=l.user_id AND u.family_id=l.family_id
        WHERE l.family_id=?1 ORDER BY l.is_primary DESC,l.label ASC,l.id ASC`,
    )
    .bind(actor.familyId)
    .all<{
      id: string;
      label: string;
      address: string | null;
      is_primary: number | boolean;
      user_id: string;
      user_name: string | null;
      user_avatar: string | null;
    }>();
  return {
    status: 200,
    body: { locations: rows.results.map(locationDto) },
  };
}

function writeChecks(
  session: Pick<D1Store, "prepare">,
  actor: D1LocationActor,
) {
  return [
    d1WriteCheck(
      session,
      `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`,
      [actor.userId, actor.familyId, actor.generation],
    ),
    d1WriteCheck(
      session,
      `EXISTS (SELECT 1 FROM "Family" WHERE id=?1 AND json_extract(features,'$.locations')=1)`,
      [actor.familyId],
    ),
  ];
}

export function createD1Location(
  actor: D1LocationActor,
  input: LocationInput,
  key: string,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: "location.create",
    input,
    key,
    database,
    authorize: (db) => authority(db, actor, "add"),
    plan: async (db) => {
      const user = await db.user.findUnique({
        where: { id: actor.userId },
        select: { id: true, name: true, avatar_url: true },
      });
      if (!user) return failure(401, "Unauthorized");
      const id = randomUUID();
      const now = Date.now();
      const location = locationDto({
        id,
        label: input.label,
        address: input.address?.trim() || null,
        is_primary: input.label.toLowerCase() === "home",
        user_id: actor.userId,
        user_name: user.name,
        user_avatar: user.avatar_url,
      });
      return {
        status: 201,
        body: { location },
        effects: (session: Pick<D1Store, "prepare">) => [
          ...writeChecks(session, actor),
          session
            .prepare(
              `INSERT INTO "FamilyLocation"(id,family_id,user_id,label,address,is_primary,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7)`,
            )
            .bind(
              id,
              actor.familyId,
              actor.userId,
              input.label,
              input.address?.trim() || null,
              Number(input.label.toLowerCase() === "home"),
              now,
            ),
        ],
      };
    },
  });
}

export function updateD1Location(
  actor: D1LocationActor,
  id: string,
  input: LocationInput,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: "location.update",
    input: { id, ...input },
    key: null,
    database,
    authorize: (db) => authority(db, actor, "update"),
    plan: async (db) => {
      const row = await db.familyLocation.findFirst({
        where: { id, family_id: actor.familyId },
        include: { user: { select: { name: true, avatar_url: true } } },
      });
      if (!row) return failure(404, "Not found");
      const now = Date.now();
      const location = locationDto({
        id,
        label: input.label,
        address: input.address?.trim() || null,
        is_primary: input.label.toLowerCase() === "home",
        user_id: row.user_id,
        user_name: row.user.name,
        user_avatar: row.user.avatar_url,
      });
      return {
        status: 200,
        body: { location },
        effects: (session: Pick<D1Store, "prepare">) => [
          ...writeChecks(session, actor),
          d1WriteCheck(
            session,
            `EXISTS (SELECT 1 FROM "FamilyLocation" WHERE id=?1 AND family_id=?2)`,
            [id, actor.familyId],
          ),
          session
            .prepare(
              `UPDATE "FamilyLocation" SET label=?1,address=?2,is_primary=?3,updated_at=?4 WHERE id=?5 AND family_id=?6`,
            )
            .bind(
              input.label,
              input.address?.trim() || null,
              Number(input.label.toLowerCase() === "home"),
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

export function deleteD1Location(
  actor: D1LocationActor,
  id: string,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: "location.delete",
    input: { id },
    key: null,
    database,
    authorize: (db) => authority(db, actor, "delete"),
    plan: async (db) => {
      const row = await db.familyLocation.findFirst({
        where: { id, family_id: actor.familyId },
        select: { id: true },
      });
      if (!row) return failure(404, "Not found");
      return {
        status: 200,
        body: { ok: true },
        effects: (session: Pick<D1Store, "prepare">) => [
          ...writeChecks(session, actor),
          d1WriteCheck(
            session,
            `EXISTS (SELECT 1 FROM "FamilyLocation" WHERE id=?1 AND family_id=?2)`,
            [id, actor.familyId],
          ),
          session
            .prepare(
              `DELETE FROM "FamilyLocation" WHERE id=?1 AND family_id=?2`,
            )
            .bind(id, actor.familyId),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}
