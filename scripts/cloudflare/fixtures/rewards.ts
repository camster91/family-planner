import type { D1Store } from "../../../src/lib/cloudflare/database";
import { approveD1Reward, claimD1Reward, createD1Reward, readD1Rewards, readD1RewardNotificationFocus, updateD1Reward } from "../../../src/lib/cloudflare/rewards";

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

  check((await readD1RewardNotificationFocus(parent, "reward-existing", db))?.id === "reward-existing", "current reward notification target resolves");
  check(await readD1RewardNotificationFocus(parent, "reward-foreign", db) === null, "foreign notification target is neutral");
  check(await readD1RewardNotificationFocus(parent, "missing-reward", db) === null, "deleted notification target is neutral");
  await db.prepare(`UPDATE Reward SET is_active=0 WHERE id='reward-existing'`).run();
  check(await readD1RewardNotificationFocus(parent, "reward-existing", db) === null, "retired available reward is neutral for parents too");
  await db.prepare(`UPDATE Reward SET is_active=1,cost=-1 WHERE id='reward-existing'`).run();
  check(await readD1RewardNotificationFocus(parent, "reward-existing", db) === null, "invalid reward cost never becomes an actionable focus");
  await db.prepare(`UPDATE Reward SET cost=20 WHERE id='reward-existing'`).run();

  // Revoke authority only after the reward query has returned its snapshot.
  const duringRead = (sql: string): D1Store => ({
    prepare: db.prepare.bind(db), batch: db.batch.bind(db),
    withSession() {
      const session = db.withSession("first-primary");
      return { batch: session.batch.bind(session), prepare(query) {
        const original = session.prepare(query);
        if (!query.includes('SELECT r.*')) return original;
        const wrap = (statement: typeof original): typeof original => ({
          bind: (...values) => wrap(statement.bind(...values)),
          first: statement.first.bind(statement), run: statement.run.bind(statement),
          async all<T>() { const result = await statement.all<T>(); await db.prepare(sql).run(); return result; },
        });
        return wrap(original);
      } };
    },
  });
  const revokedRead = await readD1Rewards(parent, {status:null,paging:{ok:true,paged:false}}, duringRead(`UPDATE User SET token_version=1 WHERE id='rewards-parent'`));
  check(revokedRead.status === 401 && !(revokedRead.body as any).rewards, "session revoked during data read discloses no rewards");
  await db.prepare(`UPDATE User SET token_version=0 WHERE id='rewards-parent'`).run();
  const movedRead = await readD1RewardNotificationFocus(parent, "reward-existing", duringRead(`UPDATE User SET family_id='rewards-family-b' WHERE id='rewards-parent'`));
  check(movedRead === null, "household change during focused read is neutral");
  await db.prepare(`UPDATE User SET family_id='rewards-family-a' WHERE id='rewards-parent'`).run();
  const disabledRead = await readD1Rewards(parent, {status:null,paging:{ok:true,paged:false}}, duringRead(`UPDATE Family SET features='{"rewards":false,"gamification":false}' WHERE id='rewards-family-a'`));
  check(disabledRead.status === 403 && !(disabledRead.body as any).rewards, "feature disabled during data read discloses no rewards");
  await db.prepare(`UPDATE Family SET features=?1 WHERE id='rewards-family-a'`).bind(features).run();

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

  const notices = await db.prepare(`SELECT user_id,title,action_url FROM Notification WHERE user_id IN ('rewards-parent','rewards-child','rewards-foreign') ORDER BY created_at,id`).all<{user_id:string;title:string;action_url:string}>();
  check(notices.results.length === 3, "one notice per accepted create, claim and approval; receipt replays send none");
  for (const [title, recipient] of [["New Reward Available!", child.userId], ["Rewards Child claimed a reward!", parent.userId], ["Reward Approved!", child.userId]]) {
    const notice = notices.results.find(row => row.title === title);
    check(notice?.user_id === recipient && notice.action_url === `/dashboard/rewards?focus=${rewardId}`, "notification keeps its authorized audience and exact reward");
  }
  await db.prepare(`DELETE FROM Notification WHERE action_url=?1`).bind(`/dashboard/rewards?focus=${rewardId}`).run();
  await createD1Reward(parent, input, "reward-create-key", db);
  await claimD1Reward(child, {rewardId}, "reward-claim-key", undefined, db);
  await approveD1Reward(parent, {rewardId}, "reward-approve-key", undefined, db);
  check((await db.prepare(`SELECT count(*) AS n FROM Notification WHERE action_url=?1`).bind(`/dashboard/rewards?focus=${rewardId}`).first<{n:number}>())?.n === 0, "deleting inbox rows does not authorize resend on receipt replay");

  await db.prepare(`UPDATE User SET notify_chores=0 WHERE id=?1`).bind(child.userId).run();
  const muted = await createD1Reward(parent, {name:"Muted reward",cost:1}, "reward-muted-key", db);
  check(muted.status === 200, "muted notification does not block reward creation");
  const mutedId = (muted.body as any).reward.id;
  await db.prepare(`UPDATE User SET notify_chores=1 WHERE id=?1`).bind(child.userId).run();
  await createD1Reward(parent, {name:"Muted reward",cost:1}, "reward-muted-key", db);
  check((await db.prepare(`SELECT count(*) AS n FROM Notification WHERE action_url=?1`).bind(`/dashboard/rewards?focus=${mutedId}`).first<{n:number}>())?.n === 0, "enabling preferences does not replay muted reward notice");

  await db.prepare(`CREATE TRIGGER rewards_notice_failure BEFORE INSERT ON Notification WHEN NEW.title='New Reward Available!' BEGIN SELECT RAISE(ABORT,'fixture notice failure'); END`).run();
  let failed = false;
  try { await createD1Reward(parent, {name:"Rollback reward",cost:1}, "reward-notice-rollback", db); } catch { failed = true; }
  await db.prepare(`DROP TRIGGER rewards_notice_failure`).run();
  check(failed, "notification failure refuses the atomic command");
  check((await db.prepare(`SELECT count(*) AS n FROM Reward WHERE name='Rollback reward'`).first<{n:number}>())?.n === 0, "failed notice rolls back reward");
  check((await db.prepare(`SELECT count(*) AS n FROM IdempotencyRecord WHERE key='reward-notice-rollback'`).first<{n:number}>())?.n === 0, "failed notice rolls back receipt");
  check((await createD1Reward(parent, {name:"Rollback reward",cost:1}, "reward-notice-rollback", db)).status === 200, "original command can succeed after a proven atomic rollback");

  // Change a recipient after planning but before the atomic witness check.
  const racing = (sql: string): D1Store => ({
    prepare: db.prepare.bind(db), batch: db.batch.bind(db),
    withSession() {
      const session = db.withSession("first-primary"); let fired = false;
      return { prepare: session.prepare.bind(session), async batch(statements) {
        if (!fired) { fired = true; await db.prepare(sql).run(); }
        return session.batch(statements);
      } };
    },
  });
  const raced = await createD1Reward(parent, {name:"Preference changed",cost:1}, "reward-pref-race", racing(`UPDATE User SET notify_chores=0 WHERE id='rewards-child'`));
  check(raced.status === 200, "preference race replans canonical reward safely");
  check((await db.prepare(`SELECT count(*) AS n FROM Notification WHERE action_url=?1`).bind(`/dashboard/rewards?focus=${(raced.body as any).reward.id}`).first<{n:number}>())?.n === 0, "late muted preference suppresses notification");
  await db.prepare(`UPDATE User SET notify_chores=1 WHERE id=?1`).bind(child.userId).run();
  const revoked = await createD1Reward(parent, {name:"Revoked creator",cost:1}, "reward-revoked-race", racing(`UPDATE User SET token_version=1 WHERE id='rewards-parent'`));
  check(revoked.status === 401, "late actor revocation refuses reward and fanout");
  check((await db.prepare(`SELECT count(*) AS n FROM Reward WHERE name='Revoked creator'`).first<{n:number}>())?.n === 0, "revoked actor leaves no reward");
  await db.prepare(`UPDATE User SET token_version=0 WHERE id=?1`).bind(parent.userId).run();

  await claimD1Reward(child, {rewardId:mutedId}, "reward-depart-claim", undefined, db);
  await db.prepare(`UPDATE User SET family_id=?1 WHERE id=?2`).bind(foreign.familyId, child.userId).run();
  const beforeDepartureApproval = await db.prepare(`SELECT count(*) AS n FROM Notification WHERE user_id=?1`).bind(child.userId).first<{n:number}>();
  check((await approveD1Reward(parent, {rewardId:mutedId}, "reward-depart-approve", undefined, db)).status === 200, "parent can finish canonical approval after claimant departure");
  const afterDepartureApproval = await db.prepare(`SELECT count(*) AS n FROM Notification WHERE user_id=?1`).bind(child.userId).first<{n:number}>();
  check(beforeDepartureApproval?.n === afterDepartureApproval?.n, "departed claimant receives no old-household approval content");

  return { read: true, create: true, update: true, claim: true, approval: true, receipts: true, points: true, householdIsolation: true, notificationTargets:true, replayNoResend:true, muted:true, notificationRollback:true, departedClaimant:true, preferenceRace:true, revokedActor:true, neutralStaleTargets:true, readAuthorityRenewal:true };
}
