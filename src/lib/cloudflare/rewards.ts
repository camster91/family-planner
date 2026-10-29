/** Native D1 rewards and redemption lifecycle.
 *
 * Rewards are household data. Reads renew the member/session/feature check
 * from D1 and writes use the person-effect receipt coordinator so a retry
 * cannot deduct points or transition the same reward twice. The conditional
 * reward and User updates are deliberately in one D1 batch: a claim is only
 * committed when both the reward is still available and the member still has
 * enough XP.
 */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import type { AssistantProofActor } from "@/lib/assistant-source-proof";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { encodeRewardCursor, type RewardPaging } from "@/lib/reward-paging";
import { REWARD_ACTION_PROTOCOL, type RewardActionCommand, type RewardActionOwner } from "@/lib/reward-action-shared";
import { executeD1PersonEffect, type NativePersonResult } from "./person-effect";
import { getD1Database, type D1Store } from "./database";
import { withD1ReadClient, type D1ReadClient, type NativeD1 } from "./read-client";
import { d1WriteCheck } from "./write-check";
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";
import type { RewardNotificationFocus } from "@/lib/reward-notification-focus";

export type D1RewardActor = AssistantProofActor;
type NativeResult = EffectResult & { replayed?: boolean };

const failure = (status: number, error: string, code?: string): EffectResult => ({
  status,
  body: code ? { error, code } : { error },
});
const parentOnly = () => failure(403, "Only parents can perform this action");

function storedFeatures(value: unknown) {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { value = {}; }
  }
  return normalizeFeatures(value);
}

async function authority(db: D1ReadClient, actor: D1RewardActor, requireParent = false): Promise<EffectResult | null> {
  const [user, family] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } }),
    db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
  ]);
  if (!user || user.family_id !== actor.familyId || user.role !== actor.role || user.token_version !== actor.generation)
    return failure(401, "Unauthorized");
  if (!family || !isFeatureEnabled(storedFeatures(family.features), "rewards"))
    return failure(403, "This feature is turned off for your family");
  if (requireParent && actor.role !== "parent") return parentOnly();
  return null;
}

function dateValue(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function bool(value: unknown) { return value === true || value === 1 || value === "1"; }

/** Keep the PostgreSQL reward response shape, including current household names. */
function rewardDto(row: any, creator?: any, claimer?: any) {
  return {
    id: row.id,
    notification_generation: row.notification_generation,
    notification_claim_id: row.notification_claim_id ?? null,
    notification_approval_id: row.notification_approval_id ?? null,
    family_id: row.family_id,
    name: row.name,
    description: row.description ?? null,
    cost: Number(row.cost),
    icon: row.icon,
    status: row.status,
    is_active: bool(row.is_active),
    created_by: row.created_by,
    claimed_by: row.claimed_by ?? null,
    claimed_at: dateValue(row.claimed_at),
    approved: bool(row.approved),
    approved_by: row.approved_by ?? null,
    approved_at: dateValue(row.approved_at),
    redeemed_at: dateValue(row.redeemed_at),
    created_at: dateValue(row.created_at),
    ...(creator === undefined ? {} : { creator: creator ? { id: creator.id, name: creator.name } : null }),
    ...(claimer === undefined ? {} : { claimer: claimer ? { id: claimer.id, name: claimer.name } : null }),
  };
}

async function authorizedRead<T>(actor: D1RewardActor, read: (db: D1ReadClient) => Promise<T>, database?: D1Store) {
  const store = database ?? await getD1Database();
  return withD1ReadClient(async db => {
    const refusal = await authority(db, actor);
    return refusal ? { refusal, value: undefined as T | undefined } : { refusal: null, value: await read(db) };
  }, store as unknown as NativeD1);
}

type RewardReadOptions = {
  rewardId?: string;
  status?: string | null;
  paging: RewardPaging;
};

/** Household-scoped reward collection/target read with the same optional keyset contract as PostgreSQL. */
export async function readD1Rewards(actor: D1RewardActor, options: RewardReadOptions, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database();
  const auth = await authorizedRead(actor, async () => true, store);
  if (auth.refusal) return auth.refusal;
  const session = store.withSession("first-primary");
  const pageOptions = options.paging.ok && options.paging.paged ? options.paging : null;
  const values: Array<string | number | null> = [actor.familyId];
  let where = `r.family_id=?1`;
  if (options.rewardId) { values.push(options.rewardId); where += ` AND r.id=?${values.length}`; }
  if (options.status) { values.push(options.status); where += ` AND r.status=?${values.length}`; }
  if (pageOptions?.cursor) {
    values.push(pageOptions.cursor.createdAt.getTime(), pageOptions.cursor.id);
    where += ` AND (r.created_at<?${values.length - 1} OR (r.created_at=?${values.length - 1} AND r.id>?${values.length}))`;
  }
  const paged = pageOptions !== null;
  const limit = paged ? pageOptions.limit + 1 : 10000;
  const rows = await session.prepare(`SELECT r.*,cu.id AS creator_id,cu.name AS creator_name,cl.id AS claimer_id,cl.name AS claimer_name
    FROM "Reward" r JOIN "User" cu ON cu.id=r.created_by AND cu.family_id=r.family_id
    LEFT JOIN "User" cl ON cl.id=r.claimed_by AND cl.family_id=r.family_id
    WHERE ${where} ORDER BY r.created_at DESC,r.id ASC LIMIT ${limit}`).bind(...values).all<any>();
  const resultRows = paged ? rows.results.slice(0, pageOptions.limit) : rows.results;
  const rewards = resultRows.map(row => rewardDto(row,
    row.creator_id ? { id: row.creator_id, name: row.creator_name } : null,
    row.claimer_id ? { id: row.claimer_id, name: row.claimer_name } : null));
  const body: Record<string, unknown> = { rewards };
  if (paged) {
    body.nextCursor = rows.results.length > pageOptions.limit && resultRows.length
      ? encodeRewardCursor(actor.familyId, options.status ?? null, { created_at: dateValue((resultRows[resultRows.length - 1] as any).created_at)!, id: (resultRows[resultRows.length - 1] as any).id })
      : null;
  }
  return { status: 200, body };
}

/** Strict owned read used by recovery-capable reward actions. */
export async function readD1OwnedReward(actor: D1RewardActor, owner: RewardActionOwner, rewardId: string, database?: D1Store): Promise<NativeResult> {
  const result = await readD1Rewards(actor, { rewardId, paging: { ok: true, paged: false } }, database);
  if (result.status !== 200) return result;
  return { status: 200, body: { protocol: REWARD_ACTION_PROTOCOL, owner, rewards: (result.body as any).rewards } };
}

/** Read one notification target without crossing back into the PostgreSQL
 * notification reader. The same household/feature/session authority as the
 * rewards shelf is renewed before the target is exposed. */
export async function readD1RewardNotificationFocus(
  actor: D1RewardActor,
  target: unknown,
  database?: D1Store,
): Promise<RewardNotificationFocus | null> {
  if (typeof target !== "string" || !MEMBER_ID_PATTERN.test(target)) return null;
  const result = await readD1Rewards(
    actor,
    { rewardId: target, status: null, paging: { ok: true, paged: false } },
    database,
  );
  if (result.status !== 200) return null;
  const reward = (result.body as { rewards?: Array<Record<string, unknown>> })
    .rewards?.[0];
  if (!reward) return null;
  const status = reward.status;
  const active = reward.is_active === true;
  const visible =
    actor.role === "parent" ||
    (status === "available" && active) ||
    reward.claimed_by === actor.userId;
  if (
    !visible ||
    !["available", "claimed", "approved", "redeemed"].includes(
      String(status),
    )
  )
    return null;
  return {
    id: String(reward.id),
    sourceGeneration: String(reward.notification_generation),
    name: String(reward.name),
    description: (reward.description as string | null) ?? null,
    cost: Number(reward.cost),
    icon: (reward.icon as string | null) ?? null,
    status: status as RewardNotificationFocus["status"],
    active,
    claimedById: (reward.claimed_by as string | null) ?? null,
    claimedByName: null,
  };
}

function rewardFor(db: D1ReadClient, actor: D1RewardActor, id: string) {
  return db.reward.findFirst({
    where: { id, family_id: actor.familyId },
    include: {
      creator: { select: { id: true, name: true } },
      claimer: { select: { id: true, name: true } },
    },
  });
}

function ownerMismatch(command: RewardActionCommand | undefined, actor: D1RewardActor) {
  if (!command) return null;
  if (command.owner.userId !== actor.userId || command.owner.familyId !== actor.familyId || command.owner.role !== actor.role || command.owner.generation !== actor.generation)
    return failure(409, "Reward review owner changed", "REWARD_COMMAND_OWNER_CHANGED");
  return null;
}

function commandSource(command: RewardActionCommand | undefined, row: any) {
  if (!command) return null;
  if (command.kind === "claim" && (row.notification_generation !== command.sourceGeneration || Number(row.cost) !== command.expectedCost))
    return failure(409, "Reward review changed", "REWARD_COMMAND_SOURCE_CHANGED");
  if (command.kind === "approve" && (row.notification_generation !== command.sourceGeneration || (row.claimed_by ?? null) !== command.expectedClaimantId))
    return failure(409, "Reward review changed", "REWARD_COMMAND_SOURCE_CHANGED");
  return null;
}

export function createD1Reward(actor: D1RewardActor, input: { name: string; description?: string; cost: number; icon?: string }, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor, action: "reward.create", input, key, database,
    authorize: db => authority(db, actor, true),
    plan: async db => {
      const creator = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, name: true } });
      if (!creator) return failure(401, "Unauthorized");
      const now = new Date(), id = randomUUID(), generation = randomUUID();
      const row = { id, notification_generation: generation, notification_claim_id: null, notification_approval_id: null,
        family_id: actor.familyId, name: input.name, description: input.description?.trim() || null, cost: input.cost,
        icon: input.icon || "gift", status: "available", is_active: true, created_by: actor.userId, claimed_by: null,
        claimed_at: null, approved: false, approved_by: null, approved_at: null, redeemed_at: null, created_at: now };
      return {
        status: 200,
        body: { reward: rewardDto(row, creator, null) },
        effects: session => [
          d1WriteCheck(session, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role=?3 AND token_version=?4)`, [actor.userId, actor.familyId, actor.role, actor.generation]),
          session.prepare(`INSERT INTO "Reward" (id,notification_generation,family_id,name,description,cost,icon,status,is_active,created_by,approved,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'available',1,?8,0,?9)`).bind(id, generation, actor.familyId, input.name, input.description?.trim() || null, input.cost, input.icon || "gift", actor.userId, now.getTime()),
        ],
      };
    },
  });
}

export function updateD1Reward(actor: D1RewardActor, input: { rewardId: string; name?: string; description?: string; cost?: number; icon?: string }, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor, action: "reward.update", input, key, database,
    authorize: db => authority(db, actor, true),
    plan: async db => {
      const current = await rewardFor(db, actor, input.rewardId);
      if (!current) return failure(404, "Reward not found");
      const next = { ...current, name: input.name === undefined ? current.name : input.name, description: input.description === undefined ? current.description : (input.description.trim() || null), cost: input.cost === undefined ? current.cost : input.cost, icon: input.icon === undefined ? current.icon : input.icon };
      const columns: string[] = [], values: Array<string | number | null> = [input.rewardId, actor.familyId];
      if (input.name !== undefined) { columns.push(`name=?${values.length + 1}`); values.push(input.name); }
      if (input.description !== undefined) { columns.push(`description=?${values.length + 1}`); values.push(input.description.trim() || null); }
      if (input.cost !== undefined) { columns.push(`cost=?${values.length + 1}`); values.push(input.cost); }
      if (input.icon !== undefined) { columns.push(`icon=?${values.length + 1}`); values.push(input.icon); }
      return {
        status: 200,
        body: { reward: rewardDto(next, (current as any).creator, (current as any).claimer) },
        effects: session => columns.length ? [d1WriteCheck(session, `EXISTS (SELECT 1 FROM "Reward" WHERE id=?1 AND family_id=?2)`, [input.rewardId, actor.familyId]), d1WriteCheck(session, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role=?3 AND token_version=?4)`, [actor.userId, actor.familyId, actor.role, actor.generation]), session.prepare(`UPDATE "Reward" SET ${columns.join(",")} WHERE id=?1 AND family_id=?2`).bind(...values), d1WriteCheck(session, "changes()=1")] : [],
      };
    },
  });
}

export function claimD1Reward(actor: D1RewardActor, input: { rewardId: string }, key: string | null, command?: Extract<RewardActionCommand, { kind: "claim" }>, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor, action: "reward.claim", input: command ?? input, key, database,
    authorize: db => authority(db, actor),
    plan: async db => {
      const current = await rewardFor(db, actor, input.rewardId);
      if (!current) return failure(404, "Reward not found");
      const mismatch = ownerMismatch(command, actor) ?? commandSource(command, current);
      if (mismatch) return mismatch;
      if (current.status !== "available" || !bool(current.is_active)) return failure(400, "Reward is not available");
      const user = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, name: true, xp: true } });
      if (!user) return failure(401, "Unauthorized");
      const cost = Number(current.cost);
      if (!Number.isSafeInteger(cost) || cost < 0) return failure(400, "Reward is not available");
      if (Number(user.xp ?? 0) < cost) return failure(400, "Not enough points for this reward");
      const now = new Date(), next = { ...current, status: "claimed", claimed_by: actor.userId, claimed_at: now };
      return {
        status: 200,
        body: { reward: rewardDto(next, (current as any).creator, user), xp: Number(user.xp) - cost },
        effects: session => [
          d1WriteCheck(session, `EXISTS (SELECT 1 FROM "Reward" WHERE id=?1 AND family_id=?2 AND status='available' AND is_active=1 AND cost=?3${command ? " AND notification_generation=?4" : ""})`, command ? [input.rewardId, actor.familyId, cost, command.sourceGeneration] : [input.rewardId, actor.familyId, cost]),
          d1WriteCheck(session, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role=?3 AND token_version=?4 AND xp>=?5)`, [actor.userId, actor.familyId, actor.role, actor.generation, cost]),
          session.prepare(`UPDATE "Reward" SET status='claimed',claimed_by=?3,claimed_at=?4 WHERE id=?1 AND family_id=?2 AND status='available' AND is_active=1 AND cost=?5${command ? " AND notification_generation=?6" : ""}`).bind(...(command ? [input.rewardId, actor.familyId, actor.userId, now.getTime(), cost, command.sourceGeneration] : [input.rewardId, actor.familyId, actor.userId, now.getTime(), cost])),
          d1WriteCheck(session, "changes()=1"),
          session.prepare(`UPDATE "User" SET xp=xp-?1 WHERE id=?2 AND family_id=?3 AND role=?4 AND token_version=?5 AND xp>=?1`).bind(cost, actor.userId, actor.familyId, actor.role, actor.generation),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}

export function approveD1Reward(actor: D1RewardActor, input: { rewardId: string }, key: string | null, command?: Extract<RewardActionCommand, { kind: "approve" }>, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor, action: "reward.approve", input: command ?? input, key, database,
    authorize: db => authority(db, actor, true),
    plan: async db => {
      const current = await rewardFor(db, actor, input.rewardId);
      if (!current) return failure(404, "Reward not found");
      const mismatch = ownerMismatch(command, actor) ?? commandSource(command, current);
      if (mismatch) return mismatch;
      if (current.status !== "claimed") return failure(400, "Reward must be claimed before approval");
      const now = new Date(), next = { ...current, status: "redeemed", approved: true, approved_by: actor.userId, approved_at: now, redeemed_at: now };
      return {
        status: 200,
        body: { reward: rewardDto(next, (current as any).creator, (current as any).claimer) },
        effects: session => [
          d1WriteCheck(session, `EXISTS (SELECT 1 FROM "Reward" WHERE id=?1 AND family_id=?2 AND status='claimed'${command ? " AND notification_generation=?3 AND (claimed_by=?4 OR (claimed_by IS NULL AND ?4 IS NULL))" : ""})`, command ? [input.rewardId, actor.familyId, command.sourceGeneration, command.expectedClaimantId] : [input.rewardId, actor.familyId]),
          d1WriteCheck(session, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
          session.prepare(`UPDATE "Reward" SET status='redeemed',approved=1,approved_by=?3,approved_at=?4,redeemed_at=?4 WHERE id=?1 AND family_id=?2 AND status='claimed'${command ? " AND notification_generation=?5 AND (claimed_by=?6 OR (claimed_by IS NULL AND ?6 IS NULL))" : ""}`).bind(...(command ? [input.rewardId, actor.familyId, actor.userId, now.getTime(), command.sourceGeneration, command.expectedClaimantId] : [input.rewardId, actor.familyId, actor.userId, now.getTime()])),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}
