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
import { inventoryIntakeInput } from "@/lib/inventory-intake-contract";
import {
  inventoryIntakeAuthority,
  persistInventoryIntake,
  confirmInventoryIntake,
  INVENTORY_INTAKE_ACTION,
} from "@/lib/inventory-intake";
import { InventoryInputError } from "@/lib/inventory";
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
    if (request.method === "GET")
      return NextResponse.json(
        { userId: actor.userId, familyId: actor.familyId },
        { headers },
      );
    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
    if (
      !(await checkRateLimit(`inventory-intake:${actor.userId}`, 60, 60_000))
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
    const input = inventoryIntakeInput.safeParse(body);
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
        action: INVENTORY_INTAKE_ACTION,
      },
      input.data,
      ({ recordId }) =>
        persistInventoryIntake(prisma!, actor, input.data, recordId!),
      {
        beforeReplay: () =>
          prisma!.$transaction((tx) => inventoryIntakeAuthority(tx, actor)),
        transformReplay: (result) =>
          confirmInventoryIntake(prisma!, actor, result),
      },
    );
    if (!response.ok) return response;
    const confirmed = await confirmInventoryIntake(prisma!, actor, {
      status: response.status,
      body: await response.json(),
    });
    return NextResponse.json(confirmed.body, {
      status: confirmed.status,
      headers: response.headers,
    });
  } catch (error) {
    if (error instanceof InventoryInputError)
      return fail(400, "INGREDIENT_UNAVAILABLE");
    logRouteError("inventory intake", error, getRequestId(request));
    return fail(500, "INTAKE_UNCONFIRMED");
  }
}
export async function GET(request: NextRequest) {
  const response = await handle(request);
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}
export const POST = GET;
