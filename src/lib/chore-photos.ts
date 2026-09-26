import { prisma } from '@/lib/prisma'

// Chore photo ownership (D3, #102).
//
// A chore photo is a file stored by POST /api/upload under UPLOAD_DIR/chores and
// served by GET /api/files/chores/<filename>. Every upload since D3 has an
// `Upload` row recording the owning family and the uploader.
//
// Writes (chore create / update / complete) accept a client-supplied photo only
// when it names an Upload owned by the caller's family. Anything else is a 400,
// so a member cannot attach another household's photo (or an arbitrary URL) to
// a chore and then have it served back to them.
//
// Reads keep a legacy fallback (expand phase): files stored before the Upload
// table existed have no row and are still served through the chore or chore
// assignment of the caller's family that references them. See
// docs/security/API_ISOLATION_AUDIT.md (D3) for the contract step that removes it.

/** Stored filename shape: 16 hex chars of a sha256 plus a served image extension. */
export const CHORE_PHOTO_FILENAME_RE = /^[a-f0-9]{16}\.(jpg|jpeg|png|webp|heic)$/i

export const CHORE_PHOTO_PATH_PREFIX = '/api/files/chores/'

export function chorePhotoPath(filename: string): string {
  return `${CHORE_PHOTO_PATH_PREFIX}${filename}`
}

/**
 * The bare filename of a chore photo reference, or null when the value is not
 * one. Accepted forms: the canonical `/api/files/chores/<filename>` path, or the
 * bare `<filename>`. Nothing else (absolute URLs, other routes, query strings,
 * data: URLs, path traversal) is accepted.
 */
export function chorePhotoFilename(ref: string): string | null {
  const name = ref.startsWith(CHORE_PHOTO_PATH_PREFIX) ? ref.slice(CHORE_PHOTO_PATH_PREFIX.length) : ref
  return CHORE_PHOTO_FILENAME_RE.test(name) ? name : null
}

export type ChorePhotoResolution =
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string }

export const CHORE_PHOTO_INVALID = 'photo_url must be a photo uploaded with /api/upload'
export const CHORE_PHOTO_NOT_OWNED = 'Photo not found. Upload it again and retry.'

/**
 * Validate a client-supplied chore photo for a write.
 *
 * - `undefined`: the field was not sent; nothing changes (`value: undefined`).
 * - `null` or `''`: clear the photo (`value: null`).
 * - equal to `current` (the chore's stored value): an unchanged resend, e.g. an
 *   edit form posting back what it loaded. Accepted as-is so legacy chores whose
 *   file has no Upload row can still be edited; it grants no new access.
 * - otherwise: must normalise to a filename with an Upload row owned by
 *   `familyId`, and is stored in the canonical `/api/files/chores/<filename>` form.
 *   A foreign family's upload gets the same 400 as a missing one, so the
 *   response does not confirm the file exists in another household.
 */
export async function resolveChorePhotoForWrite(
  familyId: string,
  input: string | null | undefined,
  current?: string | null
): Promise<ChorePhotoResolution> {
  if (input === undefined) return { ok: true, value: undefined }
  if (input === null || input === '') return { ok: true, value: null }
  if (current != null && input === current) return { ok: true, value: current }

  const filename = chorePhotoFilename(input)
  if (!filename) return { ok: false, error: CHORE_PHOTO_INVALID }

  const upload = await prisma!.upload.findFirst({
    where: { filename, family_id: familyId },
    select: { family_id: true },
  })
  // Re-check the family on the row too: never rely on the query alone.
  if (!upload || upload.family_id !== familyId) return { ok: false, error: CHORE_PHOTO_NOT_OWNED }

  return { ok: true, value: chorePhotoPath(filename) }
}

/**
 * May the caller's family be served this chore photo?
 *
 * 1. An Upload row exists: it is authoritative. Served only to its family; a
 *    chore reference from another family does NOT override it.
 * 2. No Upload row (legacy file, stored before D3): served only when a chore or
 *    chore assignment of the caller's family references it, matched on the
 *    canonical path or the bare filename. Removed in the D3 contract step.
 */
export async function canFamilyReadChorePhoto(familyId: string, filename: string): Promise<boolean> {
  const upload = await prisma!.upload.findUnique({
    where: { filename },
    select: { family_id: true },
  })
  if (upload) return upload.family_id === familyId

  // Legacy fallback (expand phase).
  const photoMatch = { OR: [{ photo_url: chorePhotoPath(filename) }, { photo_url: filename }] }
  const chore = await prisma!.chore.findFirst({
    where: { ...photoMatch, family_id: familyId },
    select: { family_id: true },
  })
  if (chore) return chore.family_id === familyId

  const assignment = await prisma!.choreAssignment.findFirst({
    where: { ...photoMatch, family_id: familyId },
    select: { family_id: true },
  })
  return assignment?.family_id === familyId
}
