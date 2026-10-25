import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { readIdempotencyKey, idempotencyError } from "@/lib/idempotency";
import { readBoundedJson, RequestBodyTooLargeError } from "@/lib/bounded-body";
import { prisma } from "@/lib/prisma";
import { inspectParentRoutineStack, type RoutineStackWriteDb } from "@/lib/routine-stack-api";
import { RoutineStackValidationError } from "@/lib/routine-stack-mutation";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function inspect(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) return error;
  const parent = requireParent(auth.user.role);
  if (parent) return parent;
  const gate = await featureGate(auth.user.family_id, "chores");
  if (gate) return gate;
  const { key, error: keyError } = readIdempotencyKey(request);
  if (keyError) return keyError;
  if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
  let body: unknown;
  try { body = await readBoundedJson(request, 2 * 1024 * 1024); }
  catch (error) { return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }); }
  const result = await inspectParentRoutineStack(prisma! as unknown as RoutineStackWriteDb, body,
    { userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, tokenVersion: auth.payload.tv ?? 0 }, key);
  return NextResponse.json(result.body, { status: result.status });
}
/** POST carries the exact draft privately, but performs no domain/receipt writes. */
export async function POST(request: NextRequest) {
  try { const response = await inspect(request); response.headers.set("Cache-Control", headers["Cache-Control"]); return response; }
  catch (error) { return NextResponse.json({ error: { code: error instanceof RoutineStackValidationError ? "INVALID_REQUEST" : "INSPECTION_UNAVAILABLE" } }, { status: error instanceof RoutineStackValidationError ? 400 : 500, headers }); }
}
