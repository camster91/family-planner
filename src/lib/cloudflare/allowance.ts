/** Native D1 allowance reads and parent-only ledger effects. */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { executeD1PersonEffect, type NativePersonResult } from "./person-effect";
import { getD1Database, type D1Store } from "./database";
import { withD1ReadClient, type D1ReadClient, type NativeD1 } from "./read-client";
import { d1WriteCheck } from "./write-check";

export type D1AllowanceActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};

type NativeResult = EffectResult & { replayed?: boolean };

const failure = (status: number, error: string): EffectResult => ({ status, body: { error } });

function dateValue(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function iso(value: unknown): string | null {
  return dateValue(value)?.toISOString() ?? null;
}

function allowanceDto(row: any) {
  return {
    id: row.id,
    amount: Number(row.amount),
    reason: row.reason ?? null,
    status: row.status,
    scheduled_for: iso(row.scheduled_for),
    paid_at: iso(row.paid_at),
    from_user_id: row.from_user_id,
    to_user_id: row.to_user_id,
    from_name: row.from_user?.name ?? row.from_name ?? null,
    to_name: row.to_user?.name ?? row.to_name ?? null,
    to_avatar: row.to_user?.avatar_url ?? row.to_avatar ?? null,
    created_at: iso(row.created_at),
  };
}

function allowanceRecord(row: any) {
  return {
    id: row.id,
    family_id: row.family_id,
    from_user_id: row.from_user_id,
    to_user_id: row.to_user_id,
    amount: Number(row.amount),
    reason: row.reason ?? null,
    status: row.status,
    scheduled_for: iso(row.scheduled_for),
    paid_at: iso(row.paid_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function storedFeatures(value: unknown) {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { value = {}; }
  }
  return normalizeFeatures(value);
}

async function authority(db: D1ReadClient, actor: D1AllowanceActor, parentOnly = false): Promise<EffectResult | null> {
  const [user, family] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } }),
    db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
  ]);
  if (!user || user.family_id !== actor.familyId || user.role !== actor.role || user.token_version !== actor.generation)
    return failure(401, "Unauthorized");
  if (!family || !isFeatureEnabled(storedFeatures(family.features), "allowance"))
    return failure(403, "This feature is turned off for your family");
  if (parentOnly && actor.role !== "parent") return failure(403, "Only parents can perform this action");
  return null;
}

async function authorizedRead<T>(actor: D1AllowanceActor, read: (db: D1ReadClient) => Promise<T>, database?: D1Store, parentOnly = false) {
  const store = database ?? await getD1Database();
  return withD1ReadClient(async db => {
    const refusal = await authority(db, actor, parentOnly);
    return refusal ? { refusal, value: undefined as T | undefined } : { refusal: null, value: await read(db) };
  }, store as unknown as NativeD1);
}

export async function readD1Allowance(actor: D1AllowanceActor, database?: D1Store): Promise<NativeResult> {
  const result = await authorizedRead(actor, db => db.allowance.findMany({
    where: actor.role === "parent" ? { family_id: actor.familyId } : { family_id: actor.familyId, to_user_id: actor.userId },
    include: {
      from_user: { select: { id: true, name: true } },
      to_user: { select: { id: true, name: true, avatar_url: true } },
    },
    orderBy: [{ status: "asc" }, { created_at: "desc" }],
    take: 100,
  }), database);
  if (result.refusal) return result.refusal;
  return { status: 200, body: { items: (result.value ?? []).map(allowanceDto) } };
}

export function createD1Allowance(actor: D1AllowanceActor, input: { to_user_id: string; amount: number; reason?: string | null }, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: "allowance.create",
    input,
    key,
    database,
    authorize: db => authority(db, actor, true),
    plan: async (db) => {
      const recipient = await db.user.findUnique({ where: { id: input.to_user_id }, select: { id: true, family_id: true, name: true, avatar_url: true } });
      if (!recipient || recipient.family_id !== actor.familyId) return failure(400, "Target user not in your family");
      const sender = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, name: true } });
      if (!sender) return failure(401, "Unauthorized");
      const now = new Date();
      const row = {
        id: randomUUID(), family_id: actor.familyId, from_user_id: actor.userId, to_user_id: input.to_user_id,
        amount: input.amount, reason: input.reason?.trim() || null, status: "pending", scheduled_for: null,
        paid_at: null, created_at: now, updated_at: now, from_user: sender, to_user: recipient,
      };
      return {
        status: 201,
        body: { allowance: allowanceRecord(row) },
        effects: (session: Pick<D1Store, "prepare">) => [
          session.prepare(`INSERT INTO "Allowance" (id,family_id,from_user_id,to_user_id,amount,reason,status,scheduled_for,paid_at,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,'pending',NULL,NULL,?7,?7)`).bind(row.id, row.family_id, row.from_user_id, row.to_user_id, row.amount, row.reason, now.getTime()),
        ],
      };
    },
  });
}

const statuses = new Set(["pending", "paid", "cancelled"]);

export function updateD1Allowance(actor: D1AllowanceActor, id: string, status: string, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: "allowance.update",
    input: { id, status },
    key: null,
    database,
    authorize: db => authority(db, actor, true),
    plan: async (db) => {
      if (!statuses.has(status)) return failure(400, "Invalid allowance status");
      const existing = await db.allowance.findFirst({
        where: { id, family_id: actor.familyId },
        include: { from_user: { select: { id: true, name: true } }, to_user: { select: { id: true, name: true, avatar_url: true } } },
      });
      if (!existing) return failure(404, "Not found");
      const now = new Date();
      const paidAt = status === "paid" ? now : null;
      const body = { allowance: allowanceRecord({ ...existing, status, paid_at: paidAt, updated_at: now }) };
      return {
        status: 200,
        body,
        effects: (session: Pick<D1Store, "prepare">) => [
          d1WriteCheck(session, "EXISTS (SELECT 1 FROM \"Allowance\" WHERE id=?1 AND family_id=?2)", [id, actor.familyId]),
          session.prepare(`UPDATE "Allowance" SET status=?1,paid_at=?2,updated_at=?3 WHERE id=?4 AND family_id=?5`).bind(status, paidAt?.getTime() ?? null, now.getTime(), id, actor.familyId),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}
