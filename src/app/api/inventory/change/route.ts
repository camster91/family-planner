import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
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
import { inventoryChangeInput } from "@/lib/inventory-change-contract";
import {
  persistInventoryChange,
  confirmInventoryChange,
  INVENTORY_CHANGE_ACTION,
} from "@/lib/inventory-change";
import { inventoryIntakeAuthority } from "@/lib/inventory-intake";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, code: string) =>
  NextResponse.json({ error: { code } }, { status, headers });
async function handle(request: NextRequest) {
  try {
    const device = await refusePairedDevice(request);
    if (device) return device;
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
    };
    const refusal = await prisma!.$transaction((tx) =>
      inventoryIntakeAuthority(tx, actor),
    );
    if (refusal)
      return NextResponse.json(refusal.body, {
        status: refusal.status,
        headers,
      });
    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
    if (
      !(await checkRateLimit(`inventory-change:${actor.userId}`, 60, 60_000))
        .allowed
    )
      return fail(429, "RATE_LIMITED");
    let body: unknown;
    try {
      body = JSON.parse(await boundedRequestText(request, 8192));
    } catch (error) {
      return fail(
        error instanceof RequestBodyTooLarge ? 413 : 400,
        "INVALID_DRAFT",
      );
    }
    const input = inventoryChangeInput.safeParse(body);
    if (!input.success) return fail(400, "INVALID_DRAFT");
    if (
      input.data.expected_user_id !== actor.userId ||
      input.data.expected_family_id !== actor.familyId
    )
      return fail(403, "AUTH_CONTEXT_CHANGED");
    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${actor.userId}`,
        familyId: actor.familyId,
        userId: actor.userId,
        action: INVENTORY_CHANGE_ACTION,
      },
      input.data,
      ({ recordId }) =>
        persistInventoryChange(prisma!, actor, input.data, recordId!),
      {
        beforeReplay: () =>
          prisma!.$transaction((tx) => inventoryIntakeAuthority(tx, actor)),
        transformReplay: (result) =>
          confirmInventoryChange(prisma!, actor, result, input.data),
      },
    );
    if (!response.ok) return response;
    const confirmed = await confirmInventoryChange(
      prisma!,
      actor,
      {
        status: response.status,
        body: await response.json(),
      },
      input.data,
    );
    return NextResponse.json(confirmed.body, {
      status: confirmed.status,
      headers: response.headers,
    });
  } catch (error) {
    logRouteError("inventory change", error, getRequestId(request));
    return fail(500, "CHANGE_UNCONFIRMED");
  }
}
export async function POST(request: NextRequest) {
  const response = await handle(request);
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}
