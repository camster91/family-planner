/**
 * Browser calls for ticking a chore on and off (#268). Completing uses the
 * existing POST /api/chores/complete; Undo uses POST /api/chores/uncomplete.
 * Both are idempotent on the server, so a repeated tap is harmless.
 */

import { PRODUCT_BRAND } from './brand'

export type ChoreTickResult = { ok: true } | { ok: false; message: string }

const OFFLINE_MESSAGE = `Couldn't reach ${PRODUCT_BRAND.name}. Check your connection and try again.`

export async function setChoreDone(choreId: string, done: boolean): Promise<ChoreTickResult> {
  let res: Response
  try {
    res = await fetch(done ? '/api/chores/complete' : '/api/chores/uncomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choreId }),
    })
  } catch {
    return { ok: false, message: OFFLINE_MESSAGE }
  }
  if (res.ok) return { ok: true }
  let message = 'Something went wrong on our side. Try again in a moment.'
  try {
    const body = await res.json()
    if (body && typeof body.error === 'string' && res.status < 500) message = body.error
  } catch {
    // Non-JSON error body: keep the generic message.
  }
  return { ok: false, message }
}

/** What POST /api/chores/verify reports about the chore after a check. */
export interface CheckedChoreState {
  id: string
  status: 'pending' | 'in_progress' | 'completed' | 'verified' | 'overdue'
  photo_verified: boolean
  verified_at: string | null
  verified_notes: string | null
  completed_at: string | null
}

export type ChoreCheckResult =
  | { ok: true; chore: CheckedChoreState | null }
  | { ok: false; message: string; chore?: CheckedChoreState | null }

/**
 * A parent checks a chore a child marked done: `approve` verifies it,
 * `reject` sends it back to the child with an optional reason. Both go through
 * POST /api/chores/verify (PATCH /api/chores drops status fields).
 */
export async function checkChore(
  choreId: string,
  decision: 'approve' | 'reject',
  notes?: string
): Promise<ChoreCheckResult> {
  let res: Response
  try {
    res = await fetch('/api/chores/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choreId, decision, ...(notes ? { verificationNotes: notes } : {}) }),
    })
  } catch {
    return { ok: false, message: OFFLINE_MESSAGE }
  }
  let body: { chore?: CheckedChoreState; error?: unknown } | null = null
  try {
    body = await res.json()
  } catch {
    // Non-JSON body: handled below.
  }
  if (res.ok) return { ok: true, chore: body?.chore ?? null }
  const message =
    body && typeof body.error === 'string' && res.status < 500
      ? body.error
      : 'Something went wrong on our side. Try again in a moment.'
  // A conflict carries the chore's current state so the page can show it.
  return { ok: false, message, chore: body?.chore ?? null }
}
