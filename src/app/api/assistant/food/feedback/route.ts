/** Optional feedback only; no provider or food-domain write. */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
import { prisma } from "@/lib/prisma";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { foodRequestOwner } from "@/lib/food-planning/owner";
import { FOOD_OWNER_HEADER } from "@/lib/food-planning/recovery-contract";
import { recordFoodAiFeedback } from "@/lib/food-planning/ai-feedback";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const refuse = (status: number) =>
  NextResponse.json(
    { error: { code: "FOOD_FEEDBACK_UNAVAILABLE" } },
    { status, headers },
  );
export async function POST(request: NextRequest) {
  try {
    const paired = await refusePairedDevice(request);
    if (paired) {
      paired.headers.set("Cache-Control", "private, no-store");
      return paired;
    }
    const [auth, denied] = await authenticateWithFamily(request);
    if (denied) {
      denied.headers.set("Cache-Control", "private, no-store");
      return denied;
    }
    if (!prisma) return refuse(503);
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      generation: auth.payload.tv ?? 0,
    };
    const owner = foodRequestOwner(request, auth.payload, actor);
    if (
      !owner ||
      !["parent", "teen"].includes(actor.role) ||
      request.headers.get(FOOD_OWNER_HEADER) !== owner.scope
    )
      return refuse(403);
    if (
      !(await checkRateLimit(`food-ai-feedback:${actor.userId}`, 30, 3600000))
        .allowed
    )
      return refuse(429);
    const input: unknown = JSON.parse(await boundedRequestText(request, 1024));
    const reply = await recordFoodAiFeedback(prisma, actor, input);
    return NextResponse.json(reply, { headers });
  } catch (error) {
    return refuse(error instanceof RequestBodyTooLarge ? 413 : 409);
  }
}
