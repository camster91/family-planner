import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { refusePairedDevice } from '@/lib/device-route'
import { canChangeListSectionSort } from '@/lib/role-capabilities'
import { setListSectionSort } from '@/lib/grocery-section-store'
import { readSectionJson, sectionError, sectionJson, sectionSortSchema } from '@/lib/grocery-section-http'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/lists/section-sort (#273) — turn store-section sorting on or off
 * for one grocery/shopping list (`List.sort_by_section`, default on). Body
 * `{ listId, sortBySection }`. Parent and teen (it changes the list for the
 * whole household, like creating a list); a child gets 403
 * `SECTION_SORT_FORBIDDEN`. A paired shared device is refused before person
 * auth. Setting the current value again is a no-op.
 */
export async function PATCH(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'lists')
    if (gate) return gate

    if (!canChangeListSectionSort(auth.user.role)) {
      return sectionError(403, 'SECTION_SORT_FORBIDDEN', 'Ask a parent or teen to change how this list is sorted.')
    }

    const json = await readSectionJson(request)
    if (!json.ok) return json.response
    const parsed = sectionSortSchema.safeParse(json.body)
    if (!parsed.success) return sectionError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message)

    // A foreign list and a missing one get the same 404.
    const result = await setListSectionSort(prisma!, {
      familyId: auth.user.family_id,
      listId: parsed.data.listId,
      sortBySection: parsed.data.sortBySection,
    })
    if (!result.ok) return sectionError(result.status, result.code, result.message)
    return sectionJson({ listId: result.listId, sortBySection: result.sortBySection })
  } catch (err) {
    console.error('Error changing list section sort:', err instanceof Error ? err.message : 'unknown error')
    return sectionError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
