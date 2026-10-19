import { NextRequest } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  authorizeMealBatchInTx,
  batchFailure,
  batchJson,
} from "@/lib/meal-batch-api";
import {
  mealRecipeSnapshot,
  RECIPE_SNAPSHOT_MAX_BYTES,
} from "@/lib/meal-recipe-history";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    const { id } = await context.params;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
      return batchJson(batchFailure(404, "BATCH_UNAVAILABLE"));
    return await prisma!.$transaction(async (tx) => {
      const refusal = await authorizeMealBatchInTx(tx, {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        tokenVersion: auth.payload.tv ?? 0,
      });
      if (refusal) return batchJson(refusal);
      const batch = await tx.mealBatch.findFirst({
        where: { id, family_id: auth.user.family_id },
        select: {
          prep_session_id: true,
          recipe_snapshot: true,
          recipe_snapshot_at: true,
        },
      });
      if (!batch) return batchJson(batchFailure(404, "BATCH_UNAVAILABLE"));
      const session = await tx.mealPrepSession.findFirst({
        where: { id: batch.prep_session_id, family_id: auth.user.family_id },
        select: { prepared_at: true },
      });
      if (!session) return batchJson(batchFailure(404, "BATCH_UNAVAILABLE"));
      if (!session.prepared_at)
        return batchJson({
          status: 200,
          body: { batchId: id, state: "not-prepared" },
        });
      if (batch.recipe_snapshot === null && !batch.recipe_snapshot_at)
        return batchJson({
          status: 200,
          body: { batchId: id, state: "not-recorded" },
        });
      const snapshot = mealRecipeSnapshot.safeParse(batch.recipe_snapshot);
      if (
        !snapshot.success ||
        !batch.recipe_snapshot_at ||
        new TextEncoder().encode(JSON.stringify(snapshot.data)).byteLength >
          RECIPE_SNAPSHOT_MAX_BYTES
      )
        return batchJson(batchFailure(409, "RECIPE_HISTORY_UPDATE_REQUIRED"));
      return batchJson({
        status: 200,
        body: {
          batchId: id,
          state: "recorded",
          capturedAt: batch.recipe_snapshot_at.toISOString(),
          snapshot: snapshot.data,
        },
      });
    });
  } catch (error) {
    logRouteError("GET prep recipe history", error, getRequestId(request));
    return batchJson(batchFailure(500, "LOAD_FAILED"));
  }
}
