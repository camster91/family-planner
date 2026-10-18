'use client'

import * as React from 'react'
import { getPersonQueue } from '@/lib/offline-queue-browser'
import type { OfflineQueue } from '@/lib/offline-queue'
import { QueueStorageRecovery } from '@/components/ui/queue-storage-recovery'

/** Keep the same deliberate recovery available on personal Today/fridge boards. */
export function PersonQueueStorageRecovery({ userId }: { userId: string }) {
  const [loaded, setLoaded] = React.useState<{ userId: string; queue: OfflineQueue } | null>(null)
  React.useEffect(() => {
    setLoaded({ userId, queue: getPersonQueue(userId) })
  }, [userId])
  return <QueueStorageRecovery queue={loaded?.userId === userId ? loaded.queue : null} />
}
