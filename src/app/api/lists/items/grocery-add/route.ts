import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily, requireFamilyMatch } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { isGroceryListType } from "@/lib/grocery-display";
import {
  readIdempotencyKey,
  idempotencyError,
  withIdempotency,
} from "@/lib/idempotency";
import { createPersonListItem } from "@/lib/person-list-item-create";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";

export const dynamic = "force-dynamic";
const schema = z
  .object({
    listId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    content: z.string().trim().min(1).max(500),
  })
  .strict();

/** Strict, person-only offline grocery add. Generic list creates remain separate. */
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const gate = await featureGate(auth.user.family_id, "lists");
    if (gate) return gate;
    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        {
          error:
            "Use a grocery list and 1 to 500 characters, with no extra fields.",
        },
        { status: 400 },
      );
    const list = await prisma!.list.findUnique({
      where: { id: parsed.data.listId },
      select: { family_id: true, type: true },
    });
    if (!list)
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    const familyError = requireFamilyMatch(list.family_id, auth.user.family_id);
    if (familyError) return familyError;
    if (!isGroceryListType(list.type))
      return NextResponse.json(
        { error: "Grocery list not found" },
        { status: 404 },
      );
    return await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: "list-item.grocery-add",
      },
      parsed.data,
      ({ recordId }) =>
        createPersonListItem(
          prisma!,
          { ...parsed.data, quantity: 1 },
          { familyId: auth.user.family_id, addedBy: auth.user.id },
          recordId,
          { groceryOnly: true },
        ),
    );
  } catch (error) {
    logRouteError(
      "POST /api/lists/items/grocery-add",
      error,
      getRequestId(request),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
