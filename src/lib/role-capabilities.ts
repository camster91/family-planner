// Per-domain role capabilities shared by API route handlers and UI (#102).
//
// These are the rules Cameron approved on issue #102 (D1–D9) and recorded in
// docs/ROLE_AND_ISOLATION_MATRIX.md. Keep this file, the route handlers and the
// matrix in step: the UI hides what the API refuses, but the API is always the
// enforcement point. Teen and child are deliberately separate here — do not
// collapse them into one "kid" rule without updating the matrix.
//
// Which /dashboard pages a teen or child may open lives in src/lib/kid-access.ts.

export type Role = 'parent' | 'teen' | 'child'

export function isParentRole(role: string | undefined | null): boolean {
  return role === 'parent'
}

// D4 — Capture spends the family's own AI provider key. Parents and teens may
// use it; children are refused with this exact message (API and UI).
export const CAPTURE_CHILD_MESSAGE = 'Ask a parent to add this.'

export function canUseCapture(role: string | undefined | null): boolean {
  return role === 'parent' || role === 'teen'
}

// D9 — Lists. Parents and teens may create a list; every member may add and
// tick items on an existing list; deleting a list or an item is parent-only.
export function canCreateList(role: string | undefined | null): boolean {
  return role === 'parent' || role === 'teen'
}

export function canDeleteListOrItem(role: string | undefined | null): boolean {
  return isParentRole(role)
}

// D9 — Notes and anniversaries: every member may create; a teen or child may
// edit only the rows they created; delete is parent-only.
export function canEditOwnedRecord(
  role: string | undefined | null,
  userId: string,
  createdBy: string | null | undefined
): boolean {
  return isParentRole(role) || (createdBy != null && createdBy === userId)
}

// D2 — Handoff. Teens see the whole sitter handoff. Children see only who is
// coming and when; code words, authorised pickups, phone numbers, house and
// emergency notes are withheld. The share token is parent-only for everyone
// else (it is a bearer credential for the public sitter page).
export const CHILD_HANDOFF_FIELDS = ['id', 'sitter_name', 'arrival_time', 'departure_time'] as const

export function shapeHandoffForRole<T extends Record<string, unknown>>(
  handoff: T,
  role: string | undefined | null
): Partial<T> {
  if (isParentRole(role)) return handoff
  if (role === 'teen') {
    const { share_token: _token, share_expires_at: _expires, ...rest } = handoff
    return rest as Partial<T>
  }
  // child, and any role this file does not know about: the minimal view.
  const out: Partial<T> = {}
  for (const key of CHILD_HANDOFF_FIELDS) {
    if (key in handoff) (out as Record<string, unknown>)[key] = handoff[key]
  }
  return out
}
