import type { D1Store } from "../../../src/lib/cloudflare/database";
import { createD1Allowance, readD1Allowance, updateD1Allowance } from "../../../src/lib/cloudflare/allowance";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Disposable two-household allowance fixture. */
export async function testAllowance(db: D1Store) {
  await db.batch([
    db.prepare(`INSERT INTO Family(id,name,invite_code,features) VALUES
      ('allowance-a','Allowance A','allowance-a-code','{"allowance":true}'),
      ('allowance-b','Allowance B','allowance-b-code','{"allowance":true}')`),
    db.prepare(`INSERT INTO User(id,email,name,role,family_id,email_verified,token_version) VALUES
      ('allowance-parent','allowance-parent@example.test','Allowance Parent','parent','allowance-a',1,0),
      ('allowance-child','allowance-child@example.test','Allowance Child','child','allowance-a',1,0),
      ('allowance-other-parent','allowance-other-parent@example.test','Other Parent','parent','allowance-b',1,0),
      ('allowance-other-child','allowance-other-child@example.test','Other Child','child','allowance-b',1,0)`),
    db.prepare(`INSERT INTO Allowance(id,family_id,from_user_id,to_user_id,amount,reason,status,created_at,updated_at) VALUES
      ('allowance-own','allowance-a','allowance-parent','allowance-child',8.5,'Weekly allowance','pending',?1,?1),
      ('allowance-foreign','allowance-b','allowance-other-parent','allowance-other-child',12,'Private allowance','pending',?1,?1)`)
      .bind(Date.parse("2026-10-28T12:00:00.000Z")),
  ]);
  const parent = { userId: "allowance-parent", familyId: "allowance-a", role: "parent", generation: 0 } as const;
  const child = { ...parent, userId: "allowance-child", role: "child" } as const;
  const foreign = { userId: "allowance-other-parent", familyId: "allowance-b", role: "parent", generation: 0 } as const;

  const parentRead = await readD1Allowance(parent, db);
  check(parentRead.status === 200 && (parentRead.body as any).items.length === 1, "parent sees household ledger");
  const childRead = await readD1Allowance(child, db);
  check(childRead.status === 200 && (childRead.body as any).items.length === 1 && (childRead.body as any).items[0].id === "allowance-own", "child sees own allowance only");
  const created = await createD1Allowance(parent, { to_user_id: "allowance-child", amount: 4.25, reason: "Extra chores" }, "allowance-create-key", db);
  check(created.status === 201, "parent creates allowance");
  const replay = await createD1Allowance(parent, { to_user_id: "allowance-child", amount: 4.25, reason: "Extra chores" }, "allowance-create-key", db);
  check(replay.replayed === true, "allowance receipt replay");
  const childCreate = await createD1Allowance(child, { to_user_id: "allowance-child", amount: 2 }, "allowance-child-key", db);
  check(childCreate.status === 403, "child cannot create allowance");
  const foreignTarget = await createD1Allowance(parent, { to_user_id: "allowance-other-child", amount: 2 }, "allowance-foreign-key", db);
  check(foreignTarget.status === 400, "foreign target refused");
  const paid = await updateD1Allowance(parent, "allowance-own", "paid", db);
  check(paid.status === 200 && (paid.body as any).allowance.status === "paid" && (paid.body as any).allowance.paid_at, "parent marks paid");
  const childPatch = await updateD1Allowance(child, "allowance-own", "cancelled", db);
  check(childPatch.status === 403, "child cannot update allowance");
  const foreignPatch = await updateD1Allowance(parent, "allowance-foreign", "paid", db);
  check(foreignPatch.status === 404, "foreign allowance hidden");
  const foreignRead = await readD1Allowance(foreign, db);
  check(foreignRead.status === 200 && (foreignRead.body as any).items.length === 1, "foreign household remains scoped");
  return { parentRead: true, childRead: true, parentOnlyWrites: true, receiptReplay: true, householdIsolation: true, paymentState: true };
}
