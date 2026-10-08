'use client'

import * as React from 'react'
import { setChoreDone } from '@/lib/chore-tick-client'
import { getPersonQueue } from '@/lib/offline-queue-browser'
import { QueueError } from '@/lib/offline-queue'
import type { BoardActions } from './board-actions'

/**
 * Board tile actions for a signed-in person (#274), on /dashboard/today with
 * or without fridge mode. Mirrors the rules the rest of the app uses:
 *
 * - a chore is tappable when it is the viewer's own, or for a parent any
 *   chore (the Undo route, POST /api/chores/uncomplete, allows exactly that);
 *   completing goes through POST /api/chores/complete, so a child's or teen's
 *   tick waits for a parent's check;
 * - a grocery tick is the explicit desired state queued in the person's #162
 *   offline queue (PATCH /api/lists/items/update with an Idempotency-Key), so
 *   it survives a dropped connection; Undo queues the opposite state.
 */
export function usePersonBoardActions(
  viewer: { id: string; role: string } | null | undefined,
  afterChange: () => void
): BoardActions | undefined {
  const afterRef = React.useRef(afterChange)
  afterRef.current = afterChange
  const viewerId = viewer?.id ?? null
  const isParent = viewer?.role === 'parent'

  return React.useMemo<BoardActions | undefined>(() => {
    if (!viewerId) return undefined
    const queue = () => getPersonQueue(viewerId)
    // Only operations this board queued are reported (and discarded) here; the
    // list page keeps showing its own failed ticks with Retry.
    const mine = new Set<string>()
    return {
      canCompleteChore: (chore) => isParent || chore.assigneeId === viewerId,
      canTickGroceries: true,
      completeChore: (chore) => setChoreDone(chore.id, true),
      undoChore: (chore) => setChoreDone(chore.id, false),
      choreDoneNote: () => (isParent ? undefined : 'A parent will check it.'),
      async setGroceryChecked(item, checked) {
        try {
          const op = await queue().enqueue('list-item.set-checked', { itemId: item.id, checked })
          mine.add(op.id)
          return { ok: true }
        } catch (error) {
          if (error instanceof QueueError && error.code === 'QUEUE_FULL') {
            return { ok: false, message: 'Too many changes are waiting to sync. Reconnect and try again.' }
          }
          return { ok: false, message: 'Something went wrong. Try again.' }
        }
      },
      onGroceryFailed(listener) {
        const q = queue()
        return q.subscribe((event) => {
          if (event.type !== 'change') return
          for (const op of q.list()) {
            if (op.action === 'device.list-item.add' || !mine.has(op.id)) continue
            if (op.state === 'failed' || op.state === 'conflict') {
              mine.delete(op.id)
              // Discard it: the board shows the server's state again instead of a stuck row.
              void q.discard(op.id)
              listener(op.payload.itemId, op.payload.checked)
            }
          }
        })
      },
      afterChange: () => afterRef.current(),
    }
  }, [viewerId, isParent])
}
