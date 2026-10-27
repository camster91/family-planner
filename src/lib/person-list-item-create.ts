/** Canonical personal item creates. Actor/target authority, item and keyed response
 * share a transaction. No-key adds remain distinct; device writes use their own auth. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { createListItem, type NewListItem } from "./list-item-create";
import { resolveDefaultGroceryListInTx } from "./grocery-from-recipe";
import { authorizePersonListItemInTx as authorize, type PersonListItemActor, type PersonListItemOptions as Options } from "./person-list-item-authority";
import { isGroceryListType } from "./grocery-display";
import type { EffectResult } from "./idempotency";

type Tx = Prisma.TransactionClient;
type Db = Pick<PrismaClient, "$transaction">;
export type { PersonListItemActor } from "./person-list-item-authority";

async function replayTarget(tx: Tx, actor: PersonListItemActor, listId: string | null, options: Options): Promise<EffectResult | null> {
  if (listId === null) return null; // Capture keeps a historical completed response, no default lookup.
  await tx.$queryRaw`SELECT "id" FROM "List" WHERE "id"=${listId} AND "family_id"=${actor.familyId} FOR SHARE`;
  const list = await tx.list.findFirst({ where: { id: listId, family_id: actor.familyId }, select: { type: true } });
  return !list || (options.groceryOnly && !isGroceryListType(list.type))
    ? { status: 404, body: { error: "List not found" } } : null;
}
/** Completed replay renews ownership, never re-verifies an expired AI source or writes a list. */
export function authorizePersonListItemReplay(db: Db, actor: PersonListItemActor, listId: string | null, options: Options = {}) {
  return db.$transaction(async tx => {
    const denied = await authorize(tx, actor, options);
    return denied ?? replayTarget(tx, actor, listId, options);
  });
}

/** Check receipt BEFORE default-list resolution or any other effect. */
async function withReceipt(tx: Tx, actor: PersonListItemActor, recordId: string | null, options: Options,
  replayListId: string | null, effect: () => Promise<EffectResult>): Promise<EffectResult> {
  const denied = await authorize(tx, actor, options);
  if (denied) return denied;
  if (recordId) {
    await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id"=${recordId} FOR UPDATE`;
    const record = await tx.idempotencyRecord.findFirst({
      where: { id: recordId, family_id: actor.familyId, user_id: actor.addedBy },
      select: { response_status: true, response_body: true },
    });
    if (!record) return { status: 409, body: { error: {
      code: "IDEMPOTENCY_IN_PROGRESS", message: "Please retry this add.", retryable: true,
    } } };
    if (record.response_status != null) {
      const targetDenied = await replayTarget(tx, actor, replayListId, options);
      return targetDenied ?? { status: record.response_status, body: record.response_body };
    }
  }
  await options.sourceGuard?.verify(tx);
  const result = await effect();
  if (recordId && result.status >= 200 && result.status < 300)
    await tx.idempotencyRecord.update({ where: { id: recordId }, data: {
      response_status: result.status,
      response_body: JSON.parse(JSON.stringify(result.body)) as Prisma.InputJsonObject,
    } });
  return result;
}
async function add(tx: Tx, input: NewListItem, actor: PersonListItemActor, recordId: string | null, options: Options): Promise<EffectResult> {
  await tx.$queryRaw`SELECT "id" FROM "List" WHERE "id"=${input.listId} AND "family_id"=${actor.familyId} FOR UPDATE`;
  options.sourceGuard?.assertCurrent?.();
  const result = await createListItem(tx, input, actor, { sourceRequestId: recordId, groceryOnly: options.groceryOnly });
  if (!result.ok) return result.reason === "ingredient_not_found"
    ? { status: 400, body: { error: "Ingredient not found" } }
    : { status: 404, body: { error: "List not found" } };
  return { status: 200, body: JSON.parse(JSON.stringify({ success: true, item: result.item })) };
}
/** Enter before receipt/list/default locks, or after already holding actor/household locks in order. */
export function createPersonListItemInTx(tx: Tx, input: NewListItem, actor: PersonListItemActor,
  recordId: string | null, options: Options = {}): Promise<EffectResult> {
  return withReceipt(tx, actor, recordId, options, input.listId, () => add(tx, input, actor, recordId, options));
}
export function createPersonListItem(db: Db, input: NewListItem, actor: PersonListItemActor,
  recordId: string | null, options: Options = {}): Promise<EffectResult> {
  return db.$transaction(tx => createPersonListItemInTx(tx, input, actor, recordId, options));
}
/** Capture may create a default list. Its stronger permission and receipt precede that choice. */
export function createCapturedGrocery(db: Db, input: { content: string; quantity: number },
  actor: PersonListItemActor, recordId: string | null): Promise<EffectResult> {
  const options = { groceryOnly: true, requireListCreation: true };
  return db.$transaction(tx => withReceipt(tx, actor, recordId, options, null, async () => {
    const list = await resolveDefaultGroceryListInTx(tx, actor.familyId, actor.addedBy);
    const result = await add(tx, { ...input, listId: list.id }, actor, recordId, options);
    if (list.created && result.status >= 400)
      throw new Error("Captured grocery transaction could not complete");
    return result;
  }));
}
