import type { D1Store } from "../../../src/lib/cloudflare/database";
import { approveD1Reward, claimD1Reward, createD1Reward, readD1Rewards, updateD1Reward } from "../../../src/lib/cloudflare/rewards";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const parent = { userId: "rewards-parent", familyId: "rewards-family-a", role: "parent", generation: 0 } as const;
const child = { userId: "rewards-child", familyId: "rewards-family-a", role: "child", generation: 0 } as const;
const foreign = { userId: "rewards-foreign", familyId: "rewards-family-b", role: "parent", generation: 0 } as const;
const features = JSON.stringify({ rewards: true, gamification: true });

/** Disposable native coverage for reward ownership, point deduction and approval. */
export async function testRewards(db: D1Store) {
  const now = Date.parse("2026-10-28T16:00:00.000Z");
  await db.batch([
    db.prepare(`INSERT INTO Family(id,name,invite_code,features) VALUES
      ('rewards-family-a','Rewards A','rewards-code-a',?1),
      ('rewards-family-b','Rewards B','rewards-code-b',?1)`).bind(features),
    db.prepare(`INSERT INTO User(id,email,name,role,family_id,xp,email_verified,token_version) VALUES
      ('rewards-parent','rewards-parent@example.test','Rewards Parent','parent','rewards-family-a',0,1,0),
      ('rewards-child','rewards-child@example.test','Rewards Child','child','rewards-family-a',50,1,0),
      ('rewards-foreign','rewards-foreign@example.test','Other Parent','parent','rewards-family-b',0,1,0)`),
    db.prepare(`INSERT INTO Reward(id,notification_generation,family_id,name,description,cost,icon,status,is_active,created_by,created_at) VALUES
      ('reward-existing','11111111-1111-4111-8111-111111111111','rewards-family-a','Existing reward','Family-only reward',20,'gift','available',1,'rewards-parent',?1),
      ('reward-foreign','22222222-2222-4222-8222-222222222222','rewards-family-b','Other reward',NULL,10,'gift','available',1,'rewards-foreign',?1)`).bind(now),
  ]);

  const parentRead = await readD1Rewards(parent, { status: null, paging: { ok: true, paged: false } }, db);
  check(parentRead.status === 200 && (parentRead.body as any).rewards.length === 1, "parent reward read stays in household");
  const childRead = await readD1Rewards(child, { rewardId: "reward-existing", status: null, paging: { ok: true, paged: false } }, db);
  check(childRead.status === 200 && (childRead.body as any).rewards[0].claimer === null, "child can inspect available reward");
  const foreignTarget = await readD1Rewards(parent, { rewardId: "reward-foreign", status: null, paging: { ok: true, paged: false } }, db);
  check(foreignTarget.status === 200 && (foreignTarget.body as any).rewards.length === 0, "foreign reward is hidden");

  const input = { name: "Movie night", description: "Pick the family film", cost: 15, icon: "film" };
  const created = await createD1Reward(parent, input, "reward-create-key", db);
  check(created.status === 200 && (created.body as any).reward.created_by === parent.userId, "parent creates reward");
  const createdReplay = await createD1Reward(parent, input, "reward-create-key", db);
  check(createdReplay.replayed && JSON.stringify(createdReplay.body) === JSON.stringify(created.body), "reward create replay");
  const rewardId = (created.body as any).reward.id as string;
  const childCreate = await createD1Reward(child, input, "reward-child-create-key", db);
  check(childCreate.status === 403, "child cannot create reward");

  const updated = await updateD1Reward(parent, { rewardId, name: "Family movie night" }, "reward-update-key", db);
  check(updated.status === 200 && (updated.body as any).reward.name === "Family movie night", "parent updates reward");
  const claimed = await claimD1Reward(child, { rewardId }, "reward-claim-key", undefined, db);
  check(claimed.status === 200 && (claimed.body as any).reward.status === "claimed" && (claimed.body as any).xp === 35, "claim deducts points atomically");
  const claimReplay = await claimD1Reward(child, { rewardId }, "reward-claim-key", undefined, db);
  check(claimReplay.replayed, "claim receipt replay");
  const approved = await approveD1Reward(parent, { rewardId }, "reward-approve-key", undefined, db);
  check(approved.status === 200 && (approved.body as any).reward.status === "redeemed" && (approved.body as any).reward.approved === true, "parent approves claim");
  const approvalReplay = await approveD1Reward(parent, { rewardId }, "reward-approve-key", undefined, db);
  check(approvalReplay.replayed, "approval receipt replay");
  const balance = await db.prepare(`SELECT xp FROM User WHERE id='rewards-child'`).first<{ xp: number }>();
  check(balance?.xp === 35, "points deducted once");

  return { read: true, create: true, update: true, claim: true, approval: true, receipts: true, points: true, householdIsolation: true };
}
