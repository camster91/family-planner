import { guardReviewDocumentSubmission } from "@/lib/review-document-submit-server";
import { captureGrocerySchema } from "@/lib/capture-grocery-contract";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import {
  createD1CapturedGrocery,
  d1AssistantIdempotencyError,
} from "@/lib/cloudflare/assistant-actions";
import { authenticateWithFamily } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { canCreateList } from "@/lib/role-capabilities";
import {
  createCapturedGrocery,
  authorizePersonListItemReplay,
} from "@/lib/person-list-item-create";
import { readIdempotencyKey, withIdempotency } from "@/lib/idempotency";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { RequestBodyTooLargeError, readBoundedJson } from "@/lib/bounded-body";

export const dynamic = "force-dynamic";

// One short item plus quantity, bounded before canonical parsing.
const MAX_CAPTURE_GROCERY_BYTES = 16 * 1024;

/**
 * Resolve the household grocery list and add the captured item in one keyed
 * transaction. The ordinary default-grocery and item-create routes remain
 * unchanged for existing clients.
 */
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const reviewRefusal = guardReviewDocumentSubmission(
      request,
      auth,
      "capture.grocery.add",
    );
    if (reviewRefusal) return reviewRefusal;

    const gate = await featureGate(auth.user.family_id, "lists");
    if (gate) return gate;
    if (!canCreateList(auth.user.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    let body: unknown;
    try {
      body = await readBoundedJson(request, MAX_CAPTURE_GROCERY_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json(
          { error: "Request is too large" },
          { status: 413 },
        );
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = captureGrocerySchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );

    const actor = {
      familyId: auth.user.family_id,
      addedBy: auth.user.id,
      role: auth.user.role,
      generation: auth.payload?.tv ?? 0,
    };
    if (storageBackend() === "d1") {
      try {
        const result = await createD1CapturedGrocery(
          {
            userId: actor.addedBy,
            familyId: actor.familyId,
            role: actor.role,
            generation: actor.generation,
            name: auth.user.name,
          },
          parsed.data,
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
        const idempotency = d1AssistantIdempotencyError(error);
        if (idempotency)
          return NextResponse.json(idempotency.body, {
            status: idempotency.status,
          });
        throw error;
      }
    }
    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: "capture.grocery.add",
      },
      parsed.data,
      ({ recordId }) =>
        createCapturedGrocery(prisma!, parsed.data, actor, recordId),
      {
        beforeReplay: () =>
          authorizePersonListItemReplay(prisma!, actor, null, {
            requireListCreation: true,
            groceryOnly: true,
          }),
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    logRouteError("POST /api/capture/grocery", error, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
