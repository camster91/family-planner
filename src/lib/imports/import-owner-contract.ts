/** Original personal import context is a precondition, never authentication. */
import { z } from 'zod'
export const IMPORT_OWNER_HEADER = 'X-Herewoven-Import-Owner'
export const IMPORT_OWNER_PROTOCOL = 'herewoven.import-owner.v1'
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
export const importOwner = z.object({ protocol: z.literal(IMPORT_OWNER_PROTOCOL), actorId: id, familyId: id,
  generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()
export type ImportOwner = z.infer<typeof importOwner>
export function sameImportOwner(a: ImportOwner, b: ImportOwner) {
  return a.protocol === b.protocol && a.actorId === b.actorId && a.familyId === b.familyId && a.generation === b.generation
}
