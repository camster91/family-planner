/**
 * Browser calls for ticking a chore on and off (#268). Completing uses the
 * existing POST /api/chores/complete; Undo uses POST /api/chores/uncomplete.
 * Both are idempotent on the server, so a repeated tap is harmless.
 */

export type ChoreTickResult = { ok: true } | { ok: false; message: string }

const OFFLINE_MESSAGE = "Couldn't reach Family Planner. Check your connection and try again."

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
