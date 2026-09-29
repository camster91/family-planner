import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { refusePairedDevice } from "@/lib/device-route";
import { escapeLikePattern } from "@/lib/household-search";
import { addUTCDays, parseDateOnly } from "@/lib/dates";
import {
  DEFAULT_USE_SOON_DAYS,
  INVENTORY_DEFAULT_LIMIT,
  INVENTORY_CREATE_ACTION,
  INVENTORY_ITEM_SELECT,
  INVENTORY_CATEGORIES,
  INVENTORY_LOCATIONS,
  INVENTORY_MAX_LIMIT,
  INVENTORY_SEARCH_MAX,
  InventoryInputError,
  canWriteInventory,
  cleanItemName,
  createInventorySchema,
  parseDays,
  resolveInventoryIngredient,
  toInventoryDto,
} from "@/lib/inventory";
import {
  inventoryError,
  inventoryJson,
  readJson,
  todayFrom,
  writeForbidden,
} from "@/lib/inventory-http";
import { readIdempotencyKey, withIdempotency } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

/**
 * GET /api/inventory?location=&category=&q=&expiringWithinDays=&today=&limit=&offset=
 * (#263, #158). The household's ACTIVE items (consumed and discarded ones are
 * left out), by name. `expiringWithinDays=N` keeps items whose date is on or
 * before today + N, passed dates included. `q` matches the name
 * (case-insensitive substring, at most 100 characters); `category` is one of
 * `INVENTORY_CATEGORIES`. Every role may read.
 */
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const gate = await featureGate(auth.user.family_id, "inventory");
    if (gate) return gate;

    const { searchParams } = new URL(request.url);
    const today = todayFrom(searchParams);
    if (today instanceof NextResponse) return today;

    const location = searchParams.get("location");
    if (
      location !== null &&
      !(INVENTORY_LOCATIONS as readonly string[]).includes(location)
    ) {
      return inventoryError(
        400,
        "VALIDATION_ERROR",
        `location must be one of ${INVENTORY_LOCATIONS.join(", ")}`,
      );
    }
    const category = searchParams.get("category");
    if (
      category !== null &&
      !(INVENTORY_CATEGORIES as readonly string[]).includes(category)
    ) {
      return inventoryError(
        400,
        "VALIDATION_ERROR",
        `category must be one of ${INVENTORY_CATEGORIES.join(", ")}`,
      );
    }
    const q = (searchParams.get("q") ?? "")
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " ");
    if (q.length > INVENTORY_SEARCH_MAX) {
      return inventoryError(
        400,
        "VALIDATION_ERROR",
        `q must be at most ${INVENTORY_SEARCH_MAX} characters`,
      );
    }
    const expiringRaw = searchParams.get("expiringWithinDays");
    const expiring =
      expiringRaw === null
        ? null
        : parseDays(expiringRaw, DEFAULT_USE_SOON_DAYS);
    if (expiringRaw !== null && expiring === null) {
      return inventoryError(
        400,
        "VALIDATION_ERROR",
        "expiringWithinDays must be a whole number from 0 to 365",
      );
    }
    const limitRaw = searchParams.get("limit");
    const offsetRaw = searchParams.get("offset");
    const limit =
      limitRaw === null ? INVENTORY_DEFAULT_LIMIT : Number(limitRaw);
    const offset = offsetRaw === null ? 0 : Number(offsetRaw);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > INVENTORY_MAX_LIMIT ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      return inventoryError(
        400,
        "VALIDATION_ERROR",
        `limit must be 1-${INVENTORY_MAX_LIMIT} and offset >= 0`,
      );
    }

    const rows = await prisma!.inventoryItem.findMany({
      where: {
        family_id: auth.user.family_id,
        status: "active",
        ...(location ? { location } : {}),
        ...(category ? { category } : {}),
        ...(q
          ? {
              name: {
                contains: escapeLikePattern(q),
                mode: "insensitive" as const,
              },
            }
          : {}),
        ...(expiring !== null
          ? { expires_on: { not: null, lte: addUTCDays(today, expiring) } }
          : {}),
      },
      select: INVENTORY_ITEM_SELECT,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((r) =>
      toInventoryDto(r, today),
    );
    return inventoryJson({
      items,
      nextOffset: hasMore ? offset + limit : null,
    });
  } catch (err) {
    console.error(
      "Error fetching inventory:",
      err instanceof Error ? err.message : "unknown error",
    );
    return inventoryError(500, "INTERNAL_ERROR", "Internal server error");
  }
}

/**
 * POST /api/inventory (#263). Parent or teen; a paired shared device is
 * refused before person auth. Without `ingredient_id` the item is linked to a
 * same-household ingredient with the same normalized name, if one exists.
 *
 * Optional fields (#158): `date_kind` (`best_before` default, or `use_by`),
 * `category`, `purchased_on`, `opened_on`.
 *
 * Optional `Idempotency-Key` (#265, `withIdempotency`): the same key with the
 * same body replays the stored 201 (`Idempotency-Replayed: true`) without a
 * second row; the same key with a different body is 422
 * `IDEMPOTENCY_KEY_REUSED`. Without the header the create simply runs.
 */
export async function POST(request: NextRequest) {
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
    const parsed = createInventorySchema.safeParse(json.body);
    if (!parsed.success)
      return inventoryError(
        400,
        "VALIDATION_ERROR",
        parsed.error.issues[0].message,
      );
    const data = parsed.data;
    const familyId = auth.user.family_id;
    const name = cleanItemName(data.name);

    const res = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId,
        userId: auth.user.id,
        action: INVENTORY_CREATE_ACTION,
      },
      data,
      async () => {
        const ingredientId = await resolveInventoryIngredient(
          prisma!,
          familyId,
          name,
          data.ingredient_id,
        );
        const created = await prisma!.inventoryItem.create({
          data: {
            family_id: familyId,
            name,
            ingredient_id: ingredientId,
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
            added_by: auth.user.id,
          },
          select: INVENTORY_ITEM_SELECT,
        });
        return { status: 201, body: { item: toInventoryDto(created, today) } };
      },
    );
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (err) {
    if (err instanceof InventoryInputError)
      return inventoryError(400, "INGREDIENT_NOT_FOUND", err.message);
    console.error(
      "Error creating inventory item:",
      err instanceof Error ? err.message : "unknown error",
    );
    return inventoryError(500, "INTERNAL_ERROR", "Internal server error");
  }
}
