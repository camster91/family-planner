import { NextRequest } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { getRequestId } from "@/lib/request-id";
import { logRouteError } from "@/lib/api-error";
import {
  authorizeMealBatchInTx,
  batchFailure,
  batchJson,
  mealPrepMutation,
  BATCH_MEALS_SELECT,
  BATCH_CONSUMPTION_SELECT,
} from "@/lib/meal-batch-api";

export const dynamic = "force-dynamic";
export const POST = (request: NextRequest) =>
  mealPrepMutation(request, "create");

export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    const cursor = new URL(request.url).searchParams.get("cursor");
    const sessionId = new URL(request.url).searchParams.get("sessionId");
    if (cursor !== null && (cursor.length === 0 || cursor.length > 128))
      return batchJson(batchFailure(400, "INVALID_CURSOR"));
    if (
      sessionId !== null &&
      (cursor !== null || sessionId.length === 0 || sessionId.length > 128)
    )
      return batchJson(batchFailure(400, "INVALID_CURSOR"));
    return await prisma!.$transaction(async (tx) => {
      const refusal = await authorizeMealBatchInTx(tx, {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        tokenVersion: auth.payload.tv ?? 0,
      });
      if (refusal) return batchJson(refusal);
      if (
        cursor &&
        !(await tx.mealPrepSession.findFirst({
          where: { id: cursor, family_id: auth.user.family_id },
          select: { id: true },
        }))
      )
        return batchJson(batchFailure(404, "SESSION_UNAVAILABLE"));
      const where = { family_id: auth.user.family_id };
      const rows = await tx.mealPrepSession.findMany({
        where: { ...where, ...(sessionId ? { id: sessionId } : {}) },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: sessionId ? 1 : 21,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          prepared_on: true,
          next_prep_on: true,
          prepared_at: true,
          batches: {
            where,
            take: 8,
            orderBy: { position: "asc" },
            select: {
              id: true,
              name: true,
              total_servings: true,
              reserve_storage: true,
              recipe_id: true,
              cook_id: true,
              meals: {
                where,
                take: 50,
                orderBy: [{ date: "asc" }, { id: "asc" }],
                select: BATCH_MEALS_SELECT,
              },
              consumption: {
                where: { ...where, cancelled_at: null },
                take: 50,
                orderBy: [{ consumed_at: "desc" }, { id: "desc" }],
                select: BATCH_CONSUMPTION_SELECT,
              },
            },
          },
        },
      });
      if (sessionId && rows.length === 0)
        return batchJson(batchFailure(404, "SESSION_UNAVAILABLE"));
      const sessions = rows.slice(0, 20);
      return batchJson({
        status: 200,
        body: {
          context: { familyId: auth.user.family_id, userId: auth.user.id },
          sessions,
          nextCursor:
            rows.length > 20 ? sessions[sessions.length - 1].id : null,
        },
      });
    });
  } catch (error) {
    logRouteError("GET /api/meals/bulk", error, getRequestId(request));
    return batchJson(batchFailure(500, "LOAD_FAILED"));
  }
}
