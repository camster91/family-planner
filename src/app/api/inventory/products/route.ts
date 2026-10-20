import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
import { inventoryIntakeAuthority } from "@/lib/inventory-intake";
import { foodGtin } from "@/lib/food-product-contract";
import { normalizeFoodBarcode } from "@/lib/food-barcode";
import {
  foodProductLookupConfig,
  lookupPublicFoodProduct,
} from "@/lib/food-product-provider";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, code: string) =>
  NextResponse.json({ error: { code } }, { status, headers });
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const device = await refusePairedDevice(request);
    if (device) {
      device.headers.set("Cache-Control", headers["Cache-Control"]);
      return device;
    }
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", headers["Cache-Control"]);
      return error;
    }
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
    };
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some((key) => !["barcode", "lookup"].includes(key)) ||
      params.getAll("barcode").length !== 1 ||
      params.getAll("lookup").length > 1 ||
      (params.has("lookup") && params.get("lookup") !== "1")
    )
      return fail(400, "INVALID_REQUEST");
    const code = foodGtin.safeParse(params.get("barcode"));
    if (!code.success) return fail(400, "INVALID_BARCODE");
    const config = foodProductLookupConfig();
    const scoped = await prisma!.$transaction(async (tx) => {
      const refusal = await inventoryIntakeAuthority(tx, actor);
      if (refusal) return { refusal };
      const product = await tx.foodProduct.findUnique({
        where: {
          family_id_barcode: { family_id: actor.familyId, barcode: code.data },
        },
        select: {
          barcode: true,
          name: true,
          brand: true,
          package_size: true,
          origin: true,
          source_url: true,
          revision: true,
        },
      });
      return { product };
    });
    if (scoped.refusal)
      return NextResponse.json(scoped.refusal.body, {
        status: scoped.refusal.status,
        headers,
      });
    let product: unknown = scoped.product ?? null;
    if (params.get("lookup") === "1") {
      if (!config) return fail(503, "PRODUCT_LOOKUP_DISABLED");
      if (normalizeFoodBarcode(code.data, "gtin_14")?.restricted)
        return fail(422, "LOCAL_OR_VARIABLE_CODE");
      // Fail closed, shared across processes. Space reads >5 seconds apart
      // instead of bursts around a fixed-minute boundary; no background retry.
      const reserved = await prisma!.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('food-product-public-read-v1'))`;
        const now = new Date();
        const key = "food-product-public-read-v1";
        const prior = await tx.rateLimitEntry.findUnique({ where: { key } });
        if (prior && prior.resetAt > now) return false;
        await tx.rateLimitEntry.upsert({
          where: { key },
          create: {
            key,
            count: 1,
            windowStart: now,
            resetAt: new Date(now.getTime() + 5100),
          },
          update: {
            count: 1,
            windowStart: now,
            resetAt: new Date(now.getTime() + 5100),
          },
        });
        return true;
      });
      if (!reserved) return fail(429, "PRODUCT_LOOKUP_WAIT");
      product = await lookupPublicFoodProduct(code.data, config);
      const refusal = await prisma!.$transaction((tx) =>
        inventoryIntakeAuthority(tx, actor),
      );
      if (refusal)
        return NextResponse.json(refusal.body, {
          status: refusal.status,
          headers,
        });
    }
    return NextResponse.json(
      {
        context: { userId: actor.userId, familyId: actor.familyId },
        barcode: code.data,
        product,
        publicLookupAvailable: !!config,
      },
      { headers },
    );
  } catch {
    return fail(503, "PRODUCT_LOOKUP_UNAVAILABLE");
  }
}
