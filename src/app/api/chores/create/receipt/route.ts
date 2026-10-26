import type { Prisma } from "@prisma/client";
import type { EffectResult } from "@/lib/idempotency";
import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { isValidIdempotencyKey } from "@/lib/idempotency-key";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import { personChoreCreateAuthority } from "@/lib/person-chore-create";
import { isProfileChoreEnabled } from "@/lib/profile-chore-gates";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

type ReceiptActor = { userId: string; familyId: string; tokenVersion: number };
async function receiptAuthority(tx: Prisma.TransactionClient, actor: ReceiptActor): Promise<EffectResult | null> {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${actor.userId} FOR SHARE`;
  const families = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Family" WHERE "id" = ${actor.familyId} FOR SHARE`;
  if (users.length !== 1 || families.length !== 1) return { status: 401, body: { error: "Unauthorized" } };
  return personChoreCreateAuthority(tx, actor);
}
const generationPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Read-only proof for the original chore create. No cached title, assignment,
 * points, routine or other private content leaves this route. No replay/pruning.
 */
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    const refusal = error ?? (auth ? requireParent(auth.user.role) : null);
    if (refusal) {
      refusal.headers.set("Cache-Control", "private, no-store");
      return refusal;
    }
    if (!auth) return reply({ error: "Unauthorized" }, 401);
    const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
    const hash = request.headers.get("X-Chore-Request-Hash") ?? "";
    const action = request.headers.get("X-Chore-Create-Action");
    if (
      !isValidIdempotencyKey(key) ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      (action !== "chore.create" && action !== "chore.profile.create")
    )
      return reply({ error: "Invalid chore receipt headers" }, 400);
    if (action === "chore.profile.create" && !isProfileChoreEnabled())
      return reply({ error: "MEMBER_PROTOCOL_UNAVAILABLE" }, 409);
    const actor: ReceiptActor = { userId: auth.user.id, familyId: auth.user.family_id, tokenVersion: auth.payload.tv ?? 0 };
    const result = await prisma!.$transaction(async (tx) => {
      const denied = await receiptAuthority(tx, actor);
      if (denied) return denied;
      const scope = `user:${actor.userId}`;
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "scope" = ${scope} AND "key" = ${key}
        AND "family_id" = ${actor.familyId} AND "user_id" = ${actor.userId} FOR SHARE`;
      const record = await tx.idempotencyRecord.findFirst({
        where: { scope: `user:${auth.user.id}`, key, family_id: actor.familyId, user_id: actor.userId },
        select: {
          user_id: true,
          family_id: true,
          action: true,
          request_hash: true,
          response_status: true,
          response_body: true,
          expires_at: true,
        },
      });
      if (
        !record ||
        record.user_id !== auth.user.id ||
        record.family_id !== auth.user.family_id
      )
        return { status: 200, body: { state: "absent" } };
      if (record.action !== action || record.request_hash !== hash)
        return { status: 409, body: { error: "CHORE_RECEIPT_CONFLICT" } };
      if (record.expires_at.getTime() <= Date.now())
        return { status: 200, body: { state: "expired" } };
      if (record.response_status === null)
        return { status: 200, body: { state: "pending" } };
      const body = record.response_body;
      const id =
        body && typeof body === "object" && !Array.isArray(body)
          ? body.choreId
          : null;
      const generation = body && typeof body === "object" && !Array.isArray(body) ? body.choreGeneration : null;
      if (
        record.response_status < 200 ||
        record.response_status >= 300 ||
        typeof id !== "string" || !id || id.length > 128 ||
        typeof generation !== "string" || !generationPattern.test(generation)
      )
        return {
          status: 200,
          body: { state: "committed", current: "unknown" },
        };
      const chore = await tx.chore.findFirst({
        where: {
          id,
          family_id: auth.user.family_id,
          member_subject_erased: false,
          responsibility_generation: generation,
          created_by: actor.userId,
        },
        select: { id: true },
      });
      return {
        status: 200,
        body: { state: "committed", current: chore ? "present" : "removed" },
      };
    }, { timeout: 5000, maxWait: 5000 });
    if (result.status >= 200 && result.status < 300) {
      const renewed = await prisma!.$transaction(tx => receiptAuthority(tx, actor), { timeout: 5000, maxWait: 5000 });
      if (renewed) return reply(renewed.body, renewed.status);
    }
    if (action === "chore.profile.create" && !isProfileChoreEnabled()) return reply({ error: "MEMBER_PROTOCOL_UNAVAILABLE" }, 409);
    return reply(result.body, result.status);
  } catch (error) {
    logRouteError("GET chore create receipt", error, getRequestId(request));
    return reply({ error: "Chore receipt unavailable" }, 500);
  }
}
