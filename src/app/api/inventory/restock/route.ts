import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import {
  readIdempotencyKey,
  idempotencyError,
  withIdempotency,
} from "@/lib/idempotency";
import { checkRateLimit } from "@/lib/rate-limit-db";
import {
  refuseInventoryReadScope,
  inventoryScopedResponse,
} from "@/lib/inventory-read-http";
import { refuseInventoryRecoveryOwner } from "@/lib/inventory-recovery-server";
import {
  restockInput,
  INVENTORY_RESTOCK_ACTION,
} from "@/lib/inventory-restock-contract";
import {
  restockAuthority,
  reviewInventoryRestock,
  persistInventoryRestock,
  confirmInventoryRestock,
} from "@/lib/inventory-restock";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { storageBackend } from "@/lib/storage-backend";
import { checkD1RateLimit } from "@/lib/cloudflare/rate-limit";
import { getD1Database } from "@/lib/cloudflare/database";
import {
  confirmD1InventoryRestock,
  persistD1InventoryRestock,
  reviewD1InventoryRestock,
} from "@/lib/cloudflare/inventory-recovery";
import { D1PersonReceiptError } from "@/lib/cloudflare/person-effect";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, code: string) =>
  NextResponse.json({ error: { code } }, { status, headers });
const query = z
  .object({
    itemId: z.string().min(1).max(128),
    listId: z.string().min(1).max(128).optional(),
    content: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
async function handle(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      generation: auth.payload.tv ?? 0,
      tokenVersion: auth.payload.tv ?? 0,
    };
    const ownerRefusal = refuseInventoryRecoveryOwner(
      request,
      auth.payload,
      auth.user,
    );
    if (ownerRefusal) return ownerRefusal;
    if (storageBackend() !== "d1" &&
      !(await checkRateLimit(`inventory-restock:${actor.userId}`, 90, 60_000))
        .allowed
    )
      return fail(429, "RATE_LIMITED");
    if (storageBackend() === "d1") {
      const database = await getD1Database();
      if (!(await checkD1RateLimit(database, `inventory-restock:${actor.userId}`, 90, 60_000, Date.now())).allowed)
        return fail(429, "RATE_LIMITED");
      if (request.method === "GET") {
        const scope = { userId: actor.userId, familyId: actor.familyId };
        const scopeRefusal = refuseInventoryReadScope(request, scope);
        if (scopeRefusal) return scopeRefusal;
        const params = new URL(request.url).searchParams;
        if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
          return fail(400, "INVALID_RESTOCK_REVIEW");
        const input = query.safeParse(Object.fromEntries(params));
        if (!input.success) return fail(400, "INVALID_RESTOCK_REVIEW");
        const result = await reviewD1InventoryRestock(actor, input.data, database);
        const response = NextResponse.json(result.body, { status: result.status, headers });
        return response.ok ? inventoryScopedResponse(response, scope) : response;
      }
      const { key, error: keyError } = readIdempotencyKey(request);
      if (keyError) return keyError;
      if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
      let body: unknown;
      try {
        body = JSON.parse(await boundedRequestText(request, 8192));
      } catch (error) {
        return fail(error instanceof RequestBodyTooLarge ? 413 : 400, "INVALID_RESTOCK");
      }
      const input = restockInput.safeParse(body);
      if (!input.success) return fail(400, "INVALID_RESTOCK");
      if (input.data.expected_user_id !== actor.userId || input.data.expected_family_id !== actor.familyId)
        return fail(403, "AUTH_CONTEXT_CHANGED");
      try {
        const result = await persistD1InventoryRestock(actor, input.data, key, database);
        const confirmed = await confirmD1InventoryRestock(actor, result, input.data, database);
        return NextResponse.json(confirmed.body, {
          status: confirmed.status,
          headers: { ...headers, ...(result.replayed ? { "Idempotency-Replayed": "true" } : {}) },
        });
      } catch (error) {
        if (error instanceof D1PersonReceiptError) return idempotencyError(error.code);
        throw error;
      }
    }
    if (request.method === "GET") {
      const scope = { userId: actor.userId, familyId: actor.familyId };
      const scopeRefusal = refuseInventoryReadScope(request, scope);
      if (scopeRefusal) return scopeRefusal;
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
        return fail(400, "INVALID_RESTOCK_REVIEW");
      const input = query.safeParse(Object.fromEntries(params));
      if (!input.success) return fail(400, "INVALID_RESTOCK_REVIEW");
      const result = await reviewInventoryRestock(prisma!, actor, input.data);
      const response = NextResponse.json(result.body, {
        status: result.status,
        headers,
      });
      return response.ok ? inventoryScopedResponse(response, scope) : response;
    }
    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
    let body: unknown;
    try {
      body = JSON.parse(await boundedRequestText(request, 8192));
    } catch (error) {
      return fail(
        error instanceof RequestBodyTooLarge ? 413 : 400,
        "INVALID_RESTOCK",
      );
    }
    const input = restockInput.safeParse(body);
    if (!input.success) return fail(400, "INVALID_RESTOCK");
    if (
      input.data.expected_user_id !== actor.userId ||
      input.data.expected_family_id !== actor.familyId
    )
      return fail(403, "AUTH_CONTEXT_CHANGED");
    const refusal = await prisma!.$transaction((tx) =>
      restockAuthority(tx, actor),
    );
    if (refusal)
      return NextResponse.json(refusal.body, {
        status: refusal.status,
        headers,
      });
    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${actor.userId}`,
        familyId: actor.familyId,
        userId: actor.userId,
        action: INVENTORY_RESTOCK_ACTION,
      },
      input.data,
      ({ recordId }) =>
        persistInventoryRestock(prisma!, actor, input.data, recordId!),
      {
        beforeReplay: () =>
          prisma!.$transaction((tx) => restockAuthority(tx, actor)),
        transformReplay: (result) =>
          confirmInventoryRestock(prisma!, actor, result, input.data),
      },
    );
    if (!response.ok) return response;
    const confirmed = await confirmInventoryRestock(
      prisma!,
      actor,
      { status: response.status, body: await response.json() },
      input.data,
    );
    return NextResponse.json(confirmed.body, {
      status: confirmed.status,
      headers: response.headers,
    });
  } catch (error) {
    logRouteError("inventory restock", error, getRequestId(request));
    return fail(500, "RESTOCK_UNCONFIRMED");
  }
}
export async function GET(request: NextRequest) {
  const response = await handle(request);
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}
export const POST = GET;
