import { getServerUser } from "@/lib/supabase/server";
import { canWriteInventory } from "@/lib/inventory";
import {
  canScanInventory,
  isFoodDocumentCaptureConfigured,
  isInventoryScanConfigured,
} from "@/lib/inventory-scan";
import { canRoleAccessPath } from "@/lib/kid-access";
import { FeatureGate } from "@/components/ui/feature-gate";
import { cookingReviewSource } from "@/lib/inventory-cooking-review-contract";
import InventoryClient from "./InventoryClient";

export const dynamic = "force-dynamic";

/**
 * Food inventory (#263). Every member may open it (kid allowlist); parents and
 * teens get the add/edit/delete controls, children read. The API enforces the
 * same roles, so hiding controls is only a courtesy.
 *
 * "Scan fridge" (#265) is shown only to parents and only when the deployment
 * has a scan provider key; the scan route answers 404 otherwise.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const validQuery =
    !(query?.cookBatch && query?.cookRecipe) &&
    !(query?.cookBatch && query?.portions) &&
    (!query?.portions || typeof query.portions === "string");
  const cooking = cookingReviewSource.safeParse(
    validQuery
      ? query?.cookBatch
        ? { kind: "batch", id: query.cookBatch }
        : {
            kind: "recipe",
            id: query?.cookRecipe,
            ...(query?.portions ? { servings: Number(query.portions) } : {}),
          }
      : null,
  );
  const user = await getServerUser();
  if (!user) return null;
  return (
    <FeatureGate featureKey="inventory">
      <InventoryClient
        key={`${user.id}:${user.family_id ?? "none"}:${user.role}`}
        intakeContext={
          user.family_id
            ? { userId: user.id, familyId: user.family_id }
            : undefined
        }
        canWrite={canWriteInventory(user.role)}
        cookingSource={
          cooking.success && canWriteInventory(user.role)
            ? cooking.data
            : undefined
        }
        recoveryRequired={
          canWriteInventory(user.role) &&
          process.env.INVENTORY_RECOVERY_ROLLBACK_READY === "1"
        }
        canOpenRecipes={canRoleAccessPath(
          user.role,
          "/dashboard/meals/recipes",
        )}
        canScan={canScanInventory(user.role) && isInventoryScanConfigured()}
        canCaptureDocuments={
          canScanInventory(user.role) && isFoodDocumentCaptureConfigured()
        }
      />
    </FeatureGate>
  );
}
