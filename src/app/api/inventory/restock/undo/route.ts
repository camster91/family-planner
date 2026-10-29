import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { refuseInventoryRecoveryOwner } from "@/lib/inventory-recovery-server";
import { undoInventoryRestock } from "@/lib/inventory-restock";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { storageBackend } from "@/lib/storage-backend";
import { checkD1RateLimit } from "@/lib/cloudflare/rate-limit";
import { getD1Database } from "@/lib/cloudflare/database";
import { undoD1InventoryRestock } from "@/lib/cloudflare/inventory-recovery";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, code: string) =>
  NextResponse.json({ error: { code } }, { status, headers });
const inputSchema = z
  .object({
    requestId: z.string().min(1).max(128),
    expected_user_id: z.string().min(1).max(128),
    expected_family_id: z.string().min(1).max(128),
  })
  .strict();
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", headers["Cache-Control"]);
      return error;
    }
    const refusal = refuseInventoryRecoveryOwner(
      request,
      auth.payload,
      auth.user,
    );
    if (refusal) return refusal;
    if (storageBackend() !== "d1" &&
      !(
        await checkRateLimit(
          `inventory-restock-undo:${auth.user.id}`,
          60,
          60_000,
        )
      ).allowed
    )
      return fail(429, "RATE_LIMITED");
    let body: unknown;
    try {
      body = JSON.parse(await boundedRequestText(request, 4096));
    } catch (error) {
      return fail(
        error instanceof RequestBodyTooLarge ? 413 : 400,
        "INVALID_RESTOCK_UNDO",
      );
    }
    const input = inputSchema.safeParse(body);
    if (!input.success) return fail(400, "INVALID_RESTOCK_UNDO");
    if (
      input.data.expected_user_id !== auth.user.id ||
      input.data.expected_family_id !== auth.user.family_id
    )
      return fail(403, "AUTH_CONTEXT_CHANGED");
    if (storageBackend() === "d1") {
      const database = await getD1Database();
      if (!(await checkD1RateLimit(database, `inventory-restock-undo:${auth.user.id}`, 60, 60_000, Date.now())).allowed)
        return fail(429, "RATE_LIMITED");
      const result = await undoD1InventoryRestock(
        {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          role: auth.user.role,
          generation: auth.payload.tv ?? 0,
        },
        input.data.requestId,
        database,
      );
      return NextResponse.json(result.body, { status: result.status, headers });
    }
    const result = await undoInventoryRestock(
      prisma!,
      {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        tokenVersion: auth.payload.tv ?? 0,
      },
      input.data.requestId,
    );
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (error) {
    logRouteError("inventory restock undo", error, getRequestId(request));
    return fail(500, "RESTOCK_UNDO_UNCONFIRMED");
  }
}
