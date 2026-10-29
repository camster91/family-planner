import { storageBackend } from "@/lib/storage-backend";
import { updateD1ListItem } from "@/lib/cloudflare/list-write";
import { D1PersonReceiptError } from "@/lib/cloudflare/person-effect";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import {
  readIdempotencyKey,
  idempotencyError,
  withIdempotency,
} from "@/lib/idempotency";
import { authorizePersonListItemInTx } from "@/lib/person-list-item-authority";
import { authorizePersonListItemReplay } from "@/lib/person-list-item-create";
import { updateListItem } from "@/lib/list-item-update";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";

export const dynamic = "force-dynamic";
const schema = z
  .object({
    itemId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    content: z.string().trim().min(1).max(500),
    quantity: z.number().int().min(1).max(9999),
  })
  .strict();

/** Online, person-only field edit. No queue, unchecked toggle or caller clock. */
export async function PATCH(request: NextRequest) {
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
            "Use an item version, 1 to 500 characters and a whole-number quantity from 1 to 9999.",
        },
        { status: 400 },
      );
    if (storageBackend() === "d1") {
      const result = await updateD1ListItem(
        {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          role: auth.user.role,
          generation: auth.payload?.tv ?? 0,
        },
        parsed.data,
        key,
        "list-item.edit",
      );
      return NextResponse.json(result.body, {
        status: result.status,
        headers: result.replayed
          ? { "Idempotency-Replayed": "true" }
          : undefined,
      });
    }
    // Live ownership must precede replay, as well as the transactional writer.
    const item = await prisma!.listItem.findUnique({
      where: { id: parsed.data.itemId },
      include: { list: { select: { family_id: true } } },
    });
    if (!item)
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    if (item.list.family_id !== auth.user.family_id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const actor = {
      familyId: auth.user.family_id,
      addedBy: auth.user.id,
      role: auth.user.role,
      generation: auth.payload?.tv ?? 0,
    };
    return await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: "list-item.edit",
      },
      parsed.data,
      ({ recordId }) =>
        updateListItem(prisma!, parsed.data, auth.user, undefined, {
          authorize: (tx) => authorizePersonListItemInTx(tx, actor, {}),
          receipt: { recordId, action: "list-item.edit" },
        }),
      {
        beforeReplay: () => authorizePersonListItemReplay(prisma!, actor, null),
      },
    );
  } catch (error) {
    if (error instanceof D1PersonReceiptError)
      return idempotencyError(error.code);
    logRouteError("PATCH /api/lists/items/edit", error, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
