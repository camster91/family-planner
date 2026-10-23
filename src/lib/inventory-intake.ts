/** One canonical stock row and compact pointer receipt commit atomically. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import {
  canWriteInventory,
  cleanItemName,
  resolveInventoryIngredient,
} from "@/lib/inventory";
import {
  hashIdempotentRequest,
  IDEMPOTENCY_TTL_MS,
  type EffectResult,
} from "@/lib/idempotency";
import {
  foodProductLicenseApproved,
  foodProductSourceUrl,
} from "@/lib/food-product-provider";
import { parseDateOnly } from "@/lib/dates";
import {
  inventoryIntakeReceipt,
  type InventoryIntakeInput,
} from "@/lib/inventory-intake-contract";
type Db = Pick<PrismaClient, "$transaction">;
export type InventoryIntakeActor = {
  userId: string;
  familyId: string;
  tokenVersion: number;
};
export const INVENTORY_INTAKE_ACTION = "inventory.intake.v1";
const failure = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});
export async function inventoryIntakeAuthority(
  tx: Prisma.TransactionClient,
  actor: InventoryIntakeActor,
): Promise<EffectResult | null> {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  const user = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { family_id: true, role: true, token_version: true },
  });
  if (!user || user.token_version !== actor.tokenVersion)
    return failure(401, "UNAUTHORIZED");
  if (user.family_id !== actor.familyId || !canWriteInventory(user.role))
    return failure(403, "INTAKE_FORBIDDEN");
  const family = await tx.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (
    !family ||
    !isFeatureEnabled(normalizeFeatures(family.features), "inventory")
  )
    return failure(403, "INVENTORY_DISABLED");
  return null;
}
export async function persistInventoryIntake(
  db: Db,
  actor: InventoryIntakeActor,
  input: InventoryIntakeInput,
  recordId: string,
) {
  return db.$transaction(async (tx) => {
    const refusal = await inventoryIntakeAuthority(tx, actor);
    if (refusal) return refusal;
    if (
      input.expected_family_id !== actor.familyId ||
      input.expected_user_id !== actor.userId
    )
      return failure(403, "AUTH_CONTEXT_CHANGED");
    await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
    const receipt = await tx.idempotencyRecord.findFirst({
      where: {
        id: recordId,
        scope: `user:${actor.userId}`,
        user_id: actor.userId,
        family_id: actor.familyId,
        action: INVENTORY_INTAKE_ACTION,
        request_hash: hashIdempotentRequest(INVENTORY_INTAKE_ACTION, input),
      },
      select: { response_status: true, response_body: true },
    });
    if (!receipt) return failure(409, "IDEMPOTENCY_IN_PROGRESS");
    if (receipt.response_status !== null)
      return { status: receipt.response_status, body: receipt.response_body };
    const age = Date.now() - new Date(input.issued_at).getTime();
    if (age < -60000 || age > IDEMPOTENCY_TTL_MS - 3600000)
      return failure(409, "INTAKE_INTENT_EXPIRED");
    const data = input.item;
    const name = cleanItemName(data.name);
    const ingredientId = await resolveInventoryIngredient(
      tx,
      actor.familyId,
      name,
      data.ingredient_id,
    );
    const product = input.product;
    if (product?.origin === "open-food-facts" && !foodProductLicenseApproved())
      return failure(403, "PRODUCT_REUSE_DISABLED");
    const productSource =
      product?.origin === "open-food-facts"
        ? foodProductSourceUrl(product.barcode)
        : null;
    if (product?.remember) {
      const existing = await tx.foodProduct.findUnique({
        where: {
          family_id_barcode: {
            family_id: actor.familyId,
            barcode: product.barcode,
          },
        },
      });
      const desired = {
        name,
        brand: product.brand,
        package_size: product.package_size,
        origin: product.origin,
        source_url: productSource,
      };
      const same =
        existing &&
        Object.entries(desired).every(
          ([key, value]) => existing[key as keyof typeof desired] === value,
        );
      if (!same && (existing?.revision ?? null) !== product.base_revision)
        return failure(409, "PRODUCT_CHANGED");
      if (!existing)
        await tx.foodProduct.create({
          data: {
            family_id: actor.familyId,
            barcode: product.barcode,
            ...desired,
          },
        });
      else if (!same)
        await tx.foodProduct.update({
          where: { id: existing.id },
          data: { ...desired, revision: { increment: 1 } },
        });
    }
    const item = await tx.inventoryItem.create({
      data: {
        family_id: actor.familyId,
        name,
        ingredient_id: ingredientId,
        barcode: product?.barcode ?? null,
        product_brand: product?.brand ?? null,
        package_size:
          product?.package_size ?? input.label?.package_size ?? null,
        product_source: productSource,
        amount: data.amount ?? null,
        unit: data.unit ?? null,
        location: data.location ?? "fridge",
        expires_on: data.expires_on ? parseDateOnly(data.expires_on) : null,
        date_kind: data.date_kind ?? "best_before",
        category: data.category ?? null,
        purchased_on: data.purchased_on
          ? parseDateOnly(data.purchased_on)
          : null,
        opened_on: data.opened_on ? parseDateOnly(data.opened_on) : null,
        added_by: actor.userId,
      },
      select: { id: true },
    });
    const body = { itemId: item.id };
    await tx.idempotencyRecord.update({
      where: { id: recordId },
      data: { response_status: 201, response_body: body },
    });
    return { status: 201, body };
  });
}
export async function confirmInventoryIntake(
  db: Db,
  actor: InventoryIntakeActor,
  result: EffectResult,
): Promise<EffectResult> {
  if (result.status !== 201) return result;
  const parsed = inventoryIntakeReceipt.safeParse(result.body);
  if (!parsed.success) return failure(409, "INTAKE_CONFIRMATION_UNAVAILABLE");
  return db.$transaction(async (tx) => {
    const refusal = await inventoryIntakeAuthority(tx, actor);
    if (refusal) return refusal;
    const item = await tx.inventoryItem.findFirst({
      where: { id: parsed.data.itemId, family_id: actor.familyId },
      select: { id: true },
    });
    return item ? result : failure(409, "INTAKE_ITEM_REMOVED");
  });
}
