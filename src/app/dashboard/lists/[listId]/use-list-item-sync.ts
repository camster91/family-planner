'use client'

import * as React from 'react'
import { getPersonQueue } from '@/lib/offline-queue-browser'
import { QueueError, type OfflineQueue, type QueuedOperation } from '@/lib/offline-queue'

export type SyncNotice = 'queue-full' | 'signed-out' | 'dropped' | null

/**
 * Offline tick/untick for list items (#162). Wraps the signed-in person's
 * queue: `setChecked` queues the explicit desired state, `stateFor` gives the
 * latest queued operation for an item, and `onSynced` hears confirmed writes.
 */
export function useListItemSync(userId: string, onSynced: (itemId: string, checked: boolean, body: unknown) => void) {
  const [ops, setOps] = React.useState<QueuedOperation[]>([])
  const [online, setOnline] = React.useState(true)
  const [notice, setNotice] = React.useState<SyncNotice>(null)
  const queueRef = React.useRef<OfflineQueue | null>(null)
  const onSyncedRef = React.useRef(onSynced)
  onSyncedRef.current = onSynced

  React.useEffect(() => {
    const queue = getPersonQueue(userId)
    queueRef.current = queue
    let active = true
    const unsubscribe = queue.subscribe((event) => {
      if (!active) return
      if (event.type === 'synced') onSyncedRef.current(event.op.payload.itemId, event.op.payload.checked, event.body)
      if (event.type === 'auth-lost') setNotice('signed-out')
      if (event.type === 'dropped') setNotice('dropped')
      setOps(queue.list())
    })
    void queue.ready.then(() => {
      if (!active) return
      setOps(queue.list())
      if (queue.loadReport().dropped > 0) setNotice('dropped')
    })

    const update = () => setOnline(navigator.onLine !== false)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [userId])

  const latestByItem = React.useMemo(() => {
    const map = new Map<string, QueuedOperation>()
    for (const op of ops) map.set(op.payload.itemId, op)
    return map
  }, [ops])

  const setChecked = React.useCallback(async (itemId: string, checked: boolean) => {
    const queue = queueRef.current
    if (!queue) return
    try {
      await queue.enqueue('list-item.set-checked', { itemId, checked })
    } catch (error) {
      if (error instanceof QueueError && error.code === 'QUEUE_FULL') setNotice('queue-full')
      else throw error
    }
  }, [])

  return {
    online,
    notice,
    dismissNotice: () => setNotice(null),
    stateFor: (itemId: string) => latestByItem.get(itemId),
    pendingCount: ops.filter((o) => o.state === 'pending' || o.state === 'syncing').length,
    setChecked,
    retry: (id: string) => queueRef.current?.retry(id),
    discard: (id: string) => queueRef.current?.discard(id),
  }
}
