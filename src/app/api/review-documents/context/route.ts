import { recipeExpectedReadOwnerRefusal, recipeReadOwnerHeaders } from "@/lib/recipe-read-authority";
import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import {
  reviewDocumentOwner,
  reviewDocumentWritingEnabled,
  reviewDocumentRecoveryAdopted,
} from "@/lib/review-document-owner";
import {
  reviewDocumentContext,
  reviewDocumentDomain,
  REVIEW_DOCUMENT_CONTRACT,
} from "@/lib/review-document-contract";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200, ownerHeaders: Record<string, string> = {}) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", ...ownerHeaders },
  });

/** No provider work, canonical writes, receipt changes or local form contents.
 * Keep the same historical owner while new edits are paused.
 */
export async function GET(request: NextRequest) {
  try {
    const [auth, refusal] = await authenticateWithFamily(request);
    if (refusal) {
      refusal.headers.set("Cache-Control", "private, no-store");
      return refusal;
    }
    const domain = reviewDocumentDomain.safeParse(
      new URL(request.url).searchParams.get("domain"),
    );
    if (!domain.success) return reply({ error: "Invalid review domain" }, 400);
    if (auth.user.role !== "parent" && auth.user.role !== "teen")
      return reply({ error: "Forbidden" }, 403);
    if (domain.data === "recipe") {
      const ownerRefusal = recipeExpectedReadOwnerRefusal(request, {
        actorId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload.tv ?? 0,
      });
      if (ownerRefusal) return ownerRefusal;
    }
    const family = await prisma!.family.findUnique({
      where: { id: auth.user.family_id },
      select: { features: true },
    });
    if (!family) return reply({ error: "Unavailable" }, 403);
    const [fresh, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    if (
      fresh.user.id !== auth.user.id ||
      fresh.user.family_id !== auth.user.family_id ||
      fresh.user.role !== auth.user.role ||
      (fresh.payload.tv ?? 0) !== (auth.payload.tv ?? 0)
    )
      return reply({ error: "Review owner changed" }, 409);
    const owner = reviewDocumentOwner(
      request,
      {
        ...fresh.payload,
        family_id: fresh.user.family_id,
        role: fresh.user.role,
      },
      domain.data,
    );
    const features = normalizeFeatures(family.features);
    const featureEnabled =
      domain.data !== "recipe" || isFeatureEnabled(features, "meals");
    return reply(
      reviewDocumentContext.parse({
        contract: REVIEW_DOCUMENT_CONTRACT,
        userId: fresh.user.id,
        familyId: fresh.user.family_id,
        domain: domain.data,
        role: fresh.user.role,
        adopted: reviewDocumentRecoveryAdopted(),
        owner,
        enabled:
          owner !== null && featureEnabled && reviewDocumentWritingEnabled(),
      }),
      200,
      domain.data === "recipe" ? recipeReadOwnerHeaders({ actorId: fresh.user.id, familyId: fresh.user.family_id,
        role: fresh.user.role, generation: fresh.payload.tv ?? 0 }) : {},
    );
  } catch (error) {
    logRouteError("GET review document context", error, getRequestId(request));
    return reply({ error: "Review drafts unavailable" }, 500);
  }
}
