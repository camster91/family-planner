/**
 * Account and household deletion: rules shared by the Settings dialog and the
 * server (docs/product/ACCOUNT_DELETION.md). No server imports.
 */

/** What a member types to confirm deleting their own account. */
export const ACCOUNT_DELETE_PHRASE = 'DELETE'

/** Error codes the deletion routes return (`{ error, code }`). */
export type AccountDeletionCode =
  | 'PASSWORD_REQUIRED'
  | 'INVALID_PASSWORD'
  | 'CONFIRMATION_MISMATCH'
  | 'LAST_PARENT'
  | 'OTHER_PARENTS_EXIST'
  | 'NO_SUCCESSOR'
  | 'PARENT_REQUIRED'
  | 'FAMILY_REQUIRED'
  | 'RATE_LIMITED'

function normalize(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Typed confirmation check. Case, surrounding spaces and repeated spaces are
 * ignored so a household called "The  Smiths" can be typed "the smiths"; an
 * empty expected value never matches.
 */
export function confirmationMatches(typed: unknown, expected: string): boolean {
  if (typeof typed !== 'string') return false
  const want = normalize(expected)
  return want.length > 0 && normalize(typed) === want
}

/** GET /api/users/deletion: what the signed-in member may delete. */
export interface DeletionOptions {
  role: string
  household: { id: string; name: string; memberCount: number; parentCount: number } | null
  /** Parent with no other parent in the household. */
  isOnlyParent: boolean
  /** May delete just their own account (false for the only parent: that is a household deletion). */
  canDeleteAccount: boolean
  /** May delete the whole household (only parent). */
  canDeleteHousehold: boolean
}
