import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { refusePairedDevice } from "@/lib/device-route";
import {
  INVENTORY_DELETE_ACTION,
  INVENTORY_ITEM_SELECT,
  INVENTORY_UPDATE_ACTION,
  InventoryInputError,
  canWriteInventory,
  toInventoryDto,
  updateInventorySchema,
} from "@/lib/inventory";
import {
  effectError,
  finishedResult,
  inventoryError,
  inventoryJson,
  itemNotFound,
  notFoundResult,
  readJson,
  todayFrom,
  writeForbidden,
} from "@/lib/inventory-http";
import { readIdempotencyKey, withIdempotency } from "@/lib/idempotency";
import { InventoryChangeConflict } from "@/lib/inventory-adjust";
import {
  editInventoryItemInTransaction,
  removeInventoryItemInTransaction,
} from "@/lib/inventory-edit";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { storageBackend } from "@/lib/storage-backend";
import { readD1InventoryItem, updateD1Inventory, deleteD1Inventory } from "@/lib/cloudflare/inventory";
import { D1PersonReceiptError } from "@/lib/cloudflare/person-effect";
import { idempotencyError } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// Every lookup is scoped by family_id, so another household's item answers
// exactly like a missing one (same 404 body).

// GET /api/inventory/[id]?today= — any role.
export async function GET(request: NextRequest, context: Context) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const gate = await featureGate(auth.user.family_id, "inventory");
    if (gate) return gate;

    const today = todayFrom(new URL(request.url).searchParams);
    if (today instanceof NextResponse) return today;

    const { id } = await context.params;
    if (storageBackend() === "d1") {
      const native = await readD1InventoryItem(
        {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          role: auth.user.role,
          generation: auth.payload.tv ?? 0,
        },
        id,
        today,
      );
      if (native.refusal)
        return NextResponse.json(native.refusal.body, {
          status: native.refusal.status,
          headers: { "Cache-Control": "private, no-store" },
        });
      return native.item ? inventoryJson({ item: native.item }) : itemNotFound();
    }
    const row = await prisma!.inventoryItem.findFirst({
      where: { id, family_id: auth.user.family_id },
      select: INVENTORY_ITEM_SELECT,
    });
    if (!row) return itemNotFound();
    return inventoryJson({ item: toInventoryDto(row, today) });
  } catch (err) {
    logRouteError("GET /api/inventory/[id]", err, getRequestId(request));
    return inventoryError(500, "INTERNAL_ERROR", "Internal server error");
  }
}

// PATCH /api/inventory/[id]?today= — parent or teen. Changing `name` without
// sending `ingredient_id` re-links the item by name (or unlinks it when no
// same-household ingredient matches); `ingredient_id: null` unlinks. Moving
// is `location`. A consumed or discarded item is 409 INVENTORY_ITEM_FINISHED
// (Undo puts it back first).
//
// Optional `Idempotency-Key` (#158): the same key and body replays the stored
// 200; a different item or body with the same key is 422. The update sets
// explicit values, so a re-run after a crash converges.
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const deviceRefusal = await refusePairedDevice(request);
    if (deviceRefusal) return deviceRefusal;

    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const gate = await featureGate(auth.user.family_id, "inventory");
    if (gate) return gate;

    if (!canWriteInventory(auth.user.role)) return writeForbidden();

    const today = todayFrom(new URL(request.url).searchParams);
    if (today instanceof NextResponse) return today;

    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;

    const json = await readJson(request);
    if (!json.ok) return json.response;
    const parsed = updateInventorySchema.safeParse(json.body);
    if (!parsed.success)
      return inventoryError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0].message,
      );
    const data = parsed.data;
    const familyId = auth.user.family_id;
    const { id } = await context.params;

    if (storageBackend() === "d1") {
      try {
        const result = await updateD1Inventory(
          {
            userId: auth.user.id,
            familyId,
            role: auth.user.role,
            generation: auth.payload.tv ?? 0,
          },
          id,
          data,
          today,
          key,
        );
        const response = NextResponse.json(result.body, {
          status: result.status,
          headers: result.replayed
            ? { "Idempotency-Replayed": "true" }
            : undefined,
        });
        response.headers.set("Cache-Control", "private, no-store");
        return response;
      } catch (error) {
        if (error instanceof D1PersonReceiptError)
          return idempotencyError(error.code);
        if (error instanceof InventoryInputError)
          return inventoryError(400, "INGREDIENT_NOT_FOUND", error.message);
        throw error;
      }
    }

    const res = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId,
        userId: auth.user.id,
        action: INVENTORY_UPDATE_ACTION,
      },
      { id, ...data },
      async () => {
        const result = await prisma!.$transaction((tx) =>
          editInventoryItemInTransaction(tx, {
            familyId,
            itemId: id,
            changes: data,
          }),
        );
        if (!result.ok)
          return result.reason === "NOT_FOUND"
            ? notFoundResult()
            : result.reason === "FINISHED"
              ? finishedResult()
              : effectError(
                  409,
                  "INVENTORY_CONFLICT",
                  "The item changed while saving. Try again.",
                );
        const row = await prisma!.inventoryItem.findFirst({
          where: { id, family_id: familyId },
          select: INVENTORY_ITEM_SELECT,
        });
        if (!row) return notFoundResult();
        return { status: 200, body: { item: toInventoryDto(row, today) } };
      },
    );
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (err) {
    if (err instanceof InventoryInputError)
      return inventoryError(400, "INGREDIENT_NOT_FOUND", err.message);
    if (err instanceof InventoryChangeConflict)
      return inventoryError(
        409,
        "INVENTORY_CONFLICT",
        "The item changed while saving. Try again.",
      );
    logRouteError("PATCH /api/inventory/[id]", err, getRequestId(request));
    return inventoryError(500, "INTERNAL_ERROR", "Internal server error");
  }
}

// DELETE /api/inventory/[id] — parent or teen. Removes the item and its
// history (for an item added by mistake); "Used it" and "Throw away" are the
// consume/discard routes, which keep history and can be undone.
// Optional `Idempotency-Key` (#158): a retry after a lost response replays the
// stored 200 instead of answering 404. With a key the delete and the
// completion of its idempotency record commit in ONE transaction, so there is
// no moment where the item is gone but the record is still "in progress": a
// retry either replays the stored 200 (the delete committed) or takes over a
// run that never deleted anything and deletes now. A delete leaves no row to
// find on takeover, so this is how it converges (compare the #283 routes,
// which stamp the record id on the row they create).
export async function DELETE(request: NextRequest, context: Context) {
  try {
    const deviceRefusal = await refusePairedDevice(request);
    if (deviceRefusal) return deviceRefusal;

    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const gate = await featureGate(auth.user.family_id, "inventory");
    if (gate) return gate;

    if (!canWriteInventory(auth.user.role)) return writeForbidden();

    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;

    const familyId = auth.user.family_id;
    const { id } = await context.params;
    if (storageBackend() === "d1") {
      try {
        const result = await deleteD1Inventory(
          {
            userId: auth.user.id,
            familyId,
            role: auth.user.role,
            generation: auth.payload.tv ?? 0,
          },
          id,
          key,
        );
        const response = NextResponse.json(result.body, {
          status: result.status,
          headers: result.replayed
            ? { "Idempotency-Replayed": "true" }
            : undefined,
        });
        response.headers.set("Cache-Control", "private, no-store");
        return response;
      } catch (error) {
        if (error instanceof D1PersonReceiptError)
          return idempotencyError(error.code);
        throw error;
      }
    }
    const res = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId,
        userId: auth.user.id,
        action: INVENTORY_DELETE_ACTION,
      },
      { id },
      async ({ recordId }) => {
        const body = { success: true };
        const deleted = await prisma!.$transaction(async (tx) => {
          const result = await removeInventoryItemInTransaction(tx, {
            itemId: id,
            familyId,
          });
          if (!result.ok) return false;
          if (recordId) {
            const confirmed = await tx.idempotencyRecord.updateMany({
              where: {
                id: recordId,
                family_id: familyId,
                response_status: null,
              },
              data: { response_status: 200, response_body: body },
            });
            if (confirmed.count !== 1) throw new InventoryChangeConflict();
          }
          return true;
        });
        if (!deleted) return notFoundResult();
        return { status: 200, body };
      },
    );
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (err) {
    if (err instanceof InventoryChangeConflict)
      return inventoryError(
        409,
        "INVENTORY_CONFLICT",
        "The item changed while saving. Try again.",
      );
    logRouteError("DELETE /api/inventory/[id]", err, getRequestId(request));
    return inventoryError(500, "INTERNAL_ERROR", "Internal server error");
  }
}
