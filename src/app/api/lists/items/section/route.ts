import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { refusePairedDevice } from '@/lib/device-route'
import { moveItemToSection } from '@/lib/grocery-section-store'
import { moveItemSectionSchema, readSectionJson, sectionError, sectionJson } from '@/lib/grocery-section-http'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/lists/items/section (#273) — "Move to…" on a grocery/shopping
 * list row. Body `{ itemId, section }`; `section: null` clears the choice.
 *
 * Sets the household's section for the row's normalized name
 * (`GrocerySectionPreference`) and, for a row linked to an ingredient,
 * `Ingredient.section`. Every member may do it (like editing an item, D9).
 * A paired shared device is refused before person auth (403
 * `DEVICE_WRITE_NOT_ALLOWED`, no device writes until #157). Setting the same
 * section twice is harmless, so no `Idempotency-Key` is needed; the offline
 * queue does not carry it (online write, OFFLINE_SYNC.md allowlist unchanged).
 */
export async function PATCH(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return gate

    const json = await readSectionJson(request)
    if (!json.ok) return json.response
    const parsed = moveItemSectionSchema.safeParse(json.body)
    if (!parsed.success) return sectionError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message)

    // A foreign item and a missing one get the same 404.
    const result = await moveItemToSection(prisma!, {
      familyId: auth.user.family_id,
      userId: auth.user.id,
      itemId: parsed.data.itemId,
      section: parsed.data.section,
    })
    if (!result.ok) return sectionError(result.status, result.code, result.message)
    return sectionJson({ nameKey: result.nameKey, override: result.override, sections: result.sections })
  } catch (err) {
    logRouteError('PATCH /api/lists/items/section', err, getRequestId(request))
    return sectionError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
