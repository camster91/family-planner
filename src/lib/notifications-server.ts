import { deliverNotification, type NotificationInput } from '@/lib/notification-delivery'
import { logRouteError } from '@/lib/api-error'

interface ChoreInfo {
  family_id?: string
  id: string
  title: string
  creator?: { id: string; name: string } | null
}

interface UserInfo {
  id: string
  name: string
}

/**
 * Route-facing wrapper. Every send goes through deliverNotification, which
 * honours the recipient's notification preferences (#286).
 */
export class NotificationServiceServer {
  /** True when a notification was created; false when muted or on error. Never throws. */
  async sendNotification(data: NotificationInput) {
    try {
      const result = await deliverNotification(data)
      return result.delivered
    } catch (error) {
      logRouteError('notification-service.send', error, undefined)
      return false
    }
  }

  async notifyChoreCompletion(chore: ChoreInfo, assignee: UserInfo) {
    // Notify the creator/parent
    if (chore.creator && chore.creator.id !== assignee.id) {
      await this.sendNotification({
        userId: chore.creator.id,
        familyId: chore.family_id,
        title: 'Chore Completed!',
        message: `${assignee.name} completed "${chore.title}"`,
        type: 'chore',
      })
    }

    // Notify the person who completed it
    await this.sendNotification({
      userId: assignee.id,
      familyId: chore.family_id,
      title: 'Great Job!',
      message: `You completed "${chore.title}"`,
      type: 'reward',
    })
  }

  async notifyChoreAssignment(chore: ChoreInfo & { due_date: Date | string }, assignedTo: UserInfo, assignedBy: UserInfo) {
    await this.sendNotification({
      userId: assignedTo.id,
      familyId: chore.family_id,
      title: 'New Chore Assigned',
      message: `${assignedBy.name} assigned you "${chore.title}" (due ${new Date(chore.due_date).toLocaleDateString()})`,
      type: 'chore',
    })
  }
}

export const notificationServiceServer = new NotificationServiceServer()
