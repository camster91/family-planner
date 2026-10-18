import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
import { featureGate } from "@/lib/feature-gate-server";
import { updateTransactionSchema } from "@/lib/validations";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { readIdempotencyKey, withIdempotency } from "@/lib/idempotency";
import {
  authorizeBudgetTransactionReplay,
  budgetTransactionAction,
  deleteBudgetTransactionWithReceipt,
  updateBudgetTransactionWithReceipt,
} from "@/lib/budget-transaction-write";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// PATCH — Update an existing transaction (family-scoped)
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const deviceRefusal = await refusePairedDevice(request);
    if (deviceRefusal) return deviceRefusal;

    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const gate = await featureGate(auth.user.family_id, "budget");
    if (gate) return gate;

    const parentError = requireParent(auth.user.role);
    if (parentError) return parentError;

    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "Transaction ID is required" },
        { status: 400 },
      );
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = updateTransactionSchema.safeParse({
      ...body,
      transactionId: id,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;

    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: budgetTransactionAction("update"),
      },
      { id, ...parsed.data },
      ({ recordId }) =>
        updateBudgetTransactionWithReceipt(
          prisma!,
          id,
          parsed.data,
          { familyId: auth.user.family_id, userId: auth.user.id },
          recordId,
        ),
      {
        beforeReplay: () =>
          authorizeBudgetTransactionReplay(
            prisma!,
            "update",
            { familyId: auth.user.family_id, userId: auth.user.id },
            id,
            key ?? undefined,
          ),
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    logRouteError(
      "PATCH /api/budget/transactions/[id]",
      error,
      getRequestId(request),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE — Delete a transaction (family-scoped)
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const deviceRefusal = await refusePairedDevice(request);
    if (deviceRefusal) return deviceRefusal;

    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const gate = await featureGate(auth.user.family_id, "budget");
    if (gate) return gate;

    const parentError = requireParent(auth.user.role);
    if (parentError) return parentError;

    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "Transaction ID is required" },
        { status: 400 },
      );
    }

    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;

    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: budgetTransactionAction("delete"),
      },
      { id },
      ({ recordId }) =>
        deleteBudgetTransactionWithReceipt(
          prisma!,
          id,
          { familyId: auth.user.family_id, userId: auth.user.id },
          recordId,
        ),
      {
        beforeReplay: () =>
          authorizeBudgetTransactionReplay(
            prisma!,
            "delete",
            { familyId: auth.user.family_id, userId: auth.user.id },
            id,
            key ?? undefined,
          ),
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    logRouteError(
      "DELETE /api/budget/transactions/[id]",
      error,
      getRequestId(request),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
