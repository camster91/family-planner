import { storageBackend } from '@/lib/storage-backend'
import { prisma } from '@/lib/prisma'
import type { ListItemTaskView } from '@/lib/list-tasks'

/** Owner and due date for the items on one list page, from whichever store is in use. */
export async function readListItemTasksForPage(familyId: string, itemIds: string[]): Promise<Map<string, ListItemTaskView>> {
  if (storageBackend() === 'd1') {
    const { readD1ListItemTasks } = await import('@/lib/cloudflare/list-tasks')
    return readD1ListItemTasks(familyId, itemIds)
  }
  const { readListItemTasks } = await import('@/lib/list-tasks-db')
  return readListItemTasks(prisma!, familyId, itemIds)
}
