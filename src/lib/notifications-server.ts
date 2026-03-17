import { prisma } from '@/lib/prisma'

interface NotificationData {
  userId: string
  title: string
  message: string
  type: 'chore' | 'event' | 'message' | 'reward' | 'system'
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

  async notifyChoreCompletion(chore: any, assignee: any) {
    // Send notification to parent/creator
    if (chore.creator && chore.creator.id !== assignee.id) {
      await this.sendNotification({
        userId: chore.creator.id,
        title: 'Chore Completed! 🎉',
        message: `${assignee.name} completed "${chore.title}"`,
        type: 'chore'
      })
    }

    // Send notification to the person who completed it
    await this.sendNotification({
      userId: assignee.id,
      title: 'Great Job!',
      message: `You completed "${chore.title}"`,
      type: 'reward'
    })
  }
  async notifyChoreAssignment(chore: any, assignedTo: any, assignedBy: any) {
    const title = 'New Chore Assigned'
    const message = `${assignedBy.name} assigned you "${chore.title}" (due ${new Date(chore.due_date).toLocaleDateString()})`

    await this.sendNotification({
      userId: assignedTo.id,
      title,
      message,
      type: 'chore',
    })
  }
}

export const notificationServiceServer = new NotificationServiceServer()
