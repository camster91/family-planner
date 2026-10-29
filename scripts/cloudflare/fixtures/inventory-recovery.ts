import {
  confirmD1InventoryRestock,
  persistD1InventoryRestock,
  readD1InventoryRecoveryContext,
  reviewD1InventoryRecovery,
  reviewD1InventoryRestock,
  undoD1InventoryRestock,
} from "../../../src/lib/cloudflare/inventory-recovery";
import { inventoryRecoveryEntry } from "../../../src/lib/inventory-recovery-contract";
import { INVENTORY_RECOVERY_REVIEW_CONTRACT } from "../../../src/lib/inventory-recovery-review-contract";
import { restockInput, restockReceipt } from "../../../src/lib/inventory-restock-contract";
import type { D1Store } from "../../../src/lib/cloudflare/database";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Disposable recovery/restock coverage with two household boundaries. */
export async function testInventoryRecovery(db: D1Store) {
  const now = new Date("2026-10-28T12:00:00.000Z");
  await db.batch([
    db.prepare(`INSERT INTO Family(id,name,invite_code,features) VALUES
      ('inventory-recovery-a','Recovery A','recovery-a','{"inventory":true,"lists":true}'),
      ('inventory-recovery-b','Recovery B','recovery-b','{"inventory":true,"lists":true}')`),
    db.prepare(`INSERT INTO User(id,email,name,role,family_id,email_verified,token_version) VALUES
      ('inventory-recovery-parent','recovery-parent@example.test','Recovery Parent','parent','inventory-recovery-a',1,0),
      ('inventory-recovery-child','recovery-child@example.test','Recovery Child','child','inventory-recovery-a',1,0),
      ('inventory-recovery-other','recovery-other@example.test','Other Parent','parent','inventory-recovery-b',1,0)`),
    db.prepare(`INSERT INTO List(id,family_id,name,type,created_by) VALUES
      ('inventory-recovery-list','inventory-recovery-a','Recovery Groceries','grocery','inventory-recovery-parent'),
      ('inventory-recovery-other-list','inventory-recovery-b','Other Groceries','grocery','inventory-recovery-other')`),
    db.prepare(`INSERT INTO InventoryItem(id,family_id,name,amount,unit,location,status,added_by,created_at,updated_at) VALUES
      ('inventory-recovery-item','inventory-recovery-a','Replacement beans',0,'cans','pantry','consumed','inventory-recovery-parent',?1,?1),
      ('inventory-recovery-other-item','inventory-recovery-b','Private beans',0,'cans','pantry','consumed','inventory-recovery-other',?1,?1)`)
      .bind(now.getTime()),
  ]);

  const actor = {
    userId: "inventory-recovery-parent",
    familyId: "inventory-recovery-a",
    role: "parent",
    generation: 0,
  } as const;
  const foreign = {
    userId: "inventory-recovery-other",
    familyId: "inventory-recovery-b",
    role: "parent",
    generation: 0,
  } as const;
  const owner = "a".repeat(64);
  const context = await readD1InventoryRecoveryContext(actor, { enabled: false, owner: null }, db);
  check(context.status === 200 && (context.body as any).familyId === actor.familyId, "recovery context authorization");

  const review = await reviewD1InventoryRestock(actor, {
    itemId: "inventory-recovery-item",
    listId: "inventory-recovery-list",
    content: "Replacement beans",
  }, db);
  check(review.status === 200 && (review.body as any).selectedListId === "inventory-recovery-list", "restock review");
  const input = restockInput.parse({
    protocol: "herewoven.inventory-restock.v1",
    expected_user_id: actor.userId,
    expected_family_id: actor.familyId,
    issued_at: now.toISOString(),
    item_id: "inventory-recovery-item",
    expected_version: now.toISOString(),
    list_id: "inventory-recovery-list",
    content: "Replacement beans",
    amount: 3,
    unit: "cans",
    allow_similar: true,
  });
  const written = await persistD1InventoryRestock(actor, input, "inventory-recovery-restock-key", db, now);
  check(written.status === 201, "restock write");
  const proof = restockReceipt.parse(written.body);
  const confirmed = await confirmD1InventoryRestock(actor, written, input, db);
  check(confirmed.status === 201 && restockReceipt.safeParse(confirmed.body).success, "restock confirmation");
  const replay = await persistD1InventoryRestock(actor, input, "inventory-recovery-restock-key", db, new Date(now.getTime() + 1000));
  check(replay.replayed === true, "restock receipt replay");
  const row = await db.prepare(`SELECT source_key,source_request_id,amount,unit FROM ListItem WHERE id=?1`).bind(proof.itemId).first<{ source_key: string; source_request_id: string; amount: number; unit: string }>();
  check(row?.source_key === "inventory:inventory-recovery-item" && row.source_request_id === proof.requestId && row.amount === 3 && row.unit === "cans", "restock provenance");

  const foreignReview = await reviewD1InventoryRestock(actor, { itemId: "inventory-recovery-other-item" }, db);
  check(foreignReview.status === 404, "foreign inventory hidden");
  const childWrite = await persistD1InventoryRestock({ ...actor, userId: "inventory-recovery-child", role: "child" }, input, "inventory-recovery-child-key", db, now);
  check(childWrite.status === 403, "child restock denied");

  const entry = inventoryRecoveryEntry.parse({ kind: "restock", key: "inventory_recovery_key_01", body: JSON.stringify(input) });
  const recovery = await reviewD1InventoryRecovery(actor, entry, owner, db, now);
  check(recovery.status === 200 && (recovery.body as any).contract === INVENTORY_RECOVERY_REVIEW_CONTRACT, "recovery review contract");
  const undone = await undoD1InventoryRestock(actor, proof.requestId, db, new Date(now.getTime() + 1000));
  check(undone.status === 200 && (undone.body as any).removedCount === 1, "restock undo");
  const undoneAgain = await undoD1InventoryRestock(actor, proof.requestId, db, new Date(now.getTime() + 2000));
  check(undoneAgain.status === 200 && (undoneAgain.body as any).removedCount === 0, "restock undo idempotence");
  const foreignContext = await readD1InventoryRecoveryContext(foreign, { enabled: false, owner: null }, db);
  check(foreignContext.status === 200 && (foreignContext.body as any).familyId === foreign.familyId, "foreign context remains scoped");
  return { context: true, review: true, householdIsolation: true, roleGate: true, receiptReplay: true, provenance: true, recoveryReview: true, undo: true };
}
