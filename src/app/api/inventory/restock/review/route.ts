import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { checkRateLimit } from "@/lib/rate-limit-db";
import {
  refuseInventoryReadScope,
  inventoryScopedResponse,
} from "@/lib/inventory-read-http";
import { reviewInventoryRestock } from "@/lib/inventory-restock";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { storageBackend } from "@/lib/storage-backend";
import { checkD1RateLimit } from "@/lib/cloudflare/rate-limit";
import { getD1Database } from "@/lib/cloudflare/database";
import { reviewD1InventoryRestock } from "@/lib/cloudflare/inventory-recovery";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, code: string) =>
  NextResponse.json({ error: { code } }, { status, headers });
const schema = z
  .object({
    itemId: z.string().min(1).max(128),
    listId: z.string().min(1).max(128).optional(),
    content: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", headers["Cache-Control"]);
      return error;
    }
    const scope = { userId: auth.user.id, familyId: auth.user.family_id };
    const refusal = refuseInventoryReadScope(request, scope);
    if (refusal) return refusal;
    if (storageBackend() !== "d1" &&
      !(await checkRateLimit(`inventory-restock:${auth.user.id}`, 90, 60_000))
        .allowed
    )
      return fail(429, "RATE_LIMITED");
    let body: unknown;
    try {
      body = JSON.parse(await boundedRequestText(request, 4096));
    } catch (error) {
      return fail(
        error instanceof RequestBodyTooLarge ? 413 : 400,
        "INVALID_RESTOCK_REVIEW",
      );
    }
    const input = schema.safeParse(body);
    if (!input.success) return fail(400, "INVALID_RESTOCK_REVIEW");
    if (storageBackend() === "d1") {
      const actor = {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        role: auth.user.role,
        generation: auth.payload.tv ?? 0,
      };
      const database = await getD1Database();
      if (!(await checkD1RateLimit(database, `inventory-restock:${actor.userId}`, 90, 60_000, Date.now())).allowed)
        return fail(429, "RATE_LIMITED");
      const result = await reviewD1InventoryRestock(actor, input.data, database);
      const response = NextResponse.json(result.body, { status: result.status, headers });
      return response.ok ? inventoryScopedResponse(response, scope) : response;
    }
    const result = await reviewInventoryRestock(
      prisma!,
      { ...scope, tokenVersion: auth.payload.tv ?? 0 },
      input.data,
    );
    const response = NextResponse.json(result.body, {
      status: result.status,
      headers,
    });
    return response.ok ? inventoryScopedResponse(response, scope) : response;
  } catch (error) {
    logRouteError("inventory restock review", error, getRequestId(request));
    return fail(500, "RESTOCK_REVIEW_UNAVAILABLE");
  }
}
