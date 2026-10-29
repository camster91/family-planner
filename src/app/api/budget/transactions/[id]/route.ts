import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import { D1PersonReceiptError } from "@/lib/cloudflare/person-effect";
import { idempotencyError } from "@/lib/idempotency";
import { deleteD1BudgetTransaction, updateD1BudgetTransaction } from "@/lib/cloudflare/budget";
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

    if (storageBackend() === "d1") {
      const result = await updateD1BudgetTransaction(
        { userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload?.tv ?? 0 },
        id,
        parsed.data,
        key,
      );
      return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { "Idempotency-Replayed": "true", "Cache-Control": "private, no-store" } : { "Cache-Control": "private, no-store" } });
    }

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
    if (error instanceof D1PersonReceiptError) return idempotencyError(error.code);
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

    if (storageBackend() === "d1") {
      const result = await deleteD1BudgetTransaction(
        { userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload?.tv ?? 0 },
        id,
        key,
      );
      return NextResponse.json(result.body, { status: result.status, headers: result.replayed ? { "Idempotency-Replayed": "true", "Cache-Control": "private, no-store" } : { "Cache-Control": "private, no-store" } });
    }

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
    if (error instanceof D1PersonReceiptError) return idempotencyError(error.code);
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
