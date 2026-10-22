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
    const result = await prisma!.$transaction(async (tx) => {
      await lockUser(tx, auth.user.id);
      await lockHousehold(tx, auth.user.family_id);
      const denied = await personChoreCreateAuthority(tx, {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        tokenVersion: auth.payload.tv ?? 0,
      });
      if (denied) return denied;
      const record = await tx.idempotencyRecord.findFirst({
        where: { scope: `user:${auth.user.id}`, key },
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
      if (
        record.response_status < 200 ||
        record.response_status >= 300 ||
        typeof id !== "string" ||
        !id
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
        },
        select: { id: true },
      });
      return {
        status: 200,
        body: { state: "committed", current: chore ? "present" : "removed" },
      };
    });
    return reply(result.body, result.status);
  } catch (error) {
    logRouteError("GET chore create receipt", error, getRequestId(request));
    return reply({ error: "Chore receipt unavailable" }, 500);
  }
}
