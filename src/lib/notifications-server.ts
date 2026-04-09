import { prisma } from '@/lib/prisma'

interface NotificationData {
  userId: string
  title: string
  message: string
  type: 'chore' | 'event' | 'message' | 'reward' | 'system' | 'achievement' | 'streak'
}

interface ChoreInfo {
  id: string
  title: string
  creator?: { id: string; name: string } | null
}

interface UserInfo {
  id: string
  name: string
}

export class NotificationServiceServer {
  async sendNotification(data: NotificationData) {
    try {
      await prisma!.notification.create({
        data: {
          user_id: data.userId,
          title: data.title,
          message: data.message,
          type: data.type,
          read: false,
        },
      })
      return true
    } catch (error) {
      console.error('Error in notification service:', error)
      return false
    }
  }

  async notifyChoreCompletion(chore: ChoreInfo, assignee: UserInfo) {
    // Notify the creator/parent
    if (chore.creator && chore.creator.id !== assignee.id) {
      await this.sendNotification({
        userId: chore.creator.id,
        title: 'Chore Completed!',
        message: `${assignee.name} completed "${chore.title}"`,
        type: 'chore',
      })
    }

    // Notify the person who completed it
    await this.sendNotification({
      userId: assignee.id,
      title: 'Great Job!',
      message: `You completed "${chore.title}"`,
      type: 'reward',
    })
  }

  async notifyChoreAssignment(chore: ChoreInfo & { due_date: Date | string }, assignedTo: UserInfo, assignedBy: UserInfo) {
    await this.sendNotification({
      userId: assignedTo.id,
      title: 'New Chore Assigned',
      message: `${assignedBy.name} assigned you "${chore.title}" (due ${new Date(chore.due_date).toLocaleDateString()})`,
      type: 'chore',
    })
  }
}

export const notificationServiceServer = new NotificationServiceServer()
