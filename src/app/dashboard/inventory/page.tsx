import { getServerUser } from '@/lib/supabase/server'
import { canWriteInventory } from '@/lib/inventory'
import { canScanInventory, isInventoryScanConfigured } from '@/lib/inventory-scan'
import { canRoleAccessPath } from '@/lib/kid-access'
import { FeatureGate } from '@/components/ui/feature-gate'
import InventoryClient from './InventoryClient'

export const dynamic = 'force-dynamic'

/**
 * Food inventory (#263). Every member may open it (kid allowlist); parents and
 * teens get the add/edit/delete controls, children read. The API enforces the
 * same roles, so hiding controls is only a courtesy.
 *
 * "Scan fridge" (#265) is shown only to parents and only when the deployment
 * has a scan provider key; the scan route answers 404 otherwise.
 */
export default async function InventoryPage() {
  const user = await getServerUser()
  if (!user) return null
  return (
    <FeatureGate featureKey="inventory">
      <InventoryClient
        canWrite={canWriteInventory(user.role)}
        canOpenRecipes={canRoleAccessPath(user.role, '/dashboard/meals/recipes')}
        canScan={canScanInventory(user.role) && isInventoryScanConfigured()}
      />
    </FeatureGate>
  )
}
