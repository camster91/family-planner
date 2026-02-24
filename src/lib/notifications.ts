import { createClient } from '@/lib/supabase/client'

interface NotificationData {
  userId: string
  title: string
  message: string
  type: 'chore' | 'event' | 'message' | 'reward' | 'system'
}

class NotificationService {
  private supabase = createClient()

  async sendNotification(data: NotificationData) {
    try {
      const { error } = await this.supabase
        .from('notifications')
        .insert([
          {
            user_id: data.userId,
            title: data.title,
            message: data.message,
            type: data.type,
            read: false,
          },
        ])

      if (error) {
        console.error('Error sending notification:', error)
        return false
      }

      return true
    } catch (err) {
      console.error('Error in sendNotification:', err)
      return false
    }
  }

  // Send notification to multiple users
  async sendNotificationsToUsers(users: string[], data: Omit<NotificationData, 'userId'>) {
    try {
      const notifications = users.map(userId => ({
        user_id: userId,
        title: data.title,
        message: data.message,
        type: data.type,
        read: false,
      }))

      const { error } = await this.supabase
        .from('notifications')
        .insert(notifications)

      if (error) {
        console.error('Error sending notifications to users:', error)
        return false
      }

      return true
    } catch (err) {
      console.error('Error in sendNotificationsToUsers:', err)
      return false
    }
  }

  // Send notification to all family members
  async sendNotificationToFamily(familyId: string, data: Omit<NotificationData, 'userId'>) {
    try {
      // Get all users in the family
      const { data: users, error: usersError } = await this.supabase
        .from('users')
        .select('id')
        .eq('family_id', familyId)

      if (usersError) {
        console.error('Error getting family users:', usersError)
        return false
      }

      if (!users || users.length === 0) {
        return false
      }

      const userIds = users.map(user => user.id)
      return this.sendNotificationsToUsers(userIds, data)
    } catch (err) {
      console.error('Error in sendNotificationToFamily:', err)
      return false
    }
  }

  // Chore completion notification
  async notifyChoreCompletion(chore: any, completedBy: any) {
    const title = 'Chore Completed! 🎉'
    const message = `${completedBy.name} completed "${chore.title}" and earned ${chore.points} points!`

    // Notify the parent/creator
    if (chore.created_by !== completedBy.id) {
      await this.sendNotification({
        userId: chore.created_by,
        title,
        message,
        type: 'chore',
      })
    }

    // Also notify the person who completed it
    await this.sendNotification({
      userId: completedBy.id,
      title: 'Great Job!',
      message: `You completed "${chore.title}" and earned ${chore.points} points!`,
      type: 'reward',
    })
  }

  // Chore assignment notification
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

  // Event reminder notification
  async notifyEventReminder(event: any, users: any[]) {
    const title = 'Upcoming Event'
    const message = `"${event.title}" is coming up soon (${new Date(event.start_time).toLocaleDateString()})`

    const userIds = users.map(user => user.id)
    await this.sendNotificationsToUsers(userIds, {
      title,
      message,
      type: 'event',
    })
  }

  // New message notification
  async notifyNewMessage(message: any, sender: any, familyMembers: any[]) {
    // Don't notify the sender
    const recipients = familyMembers.filter(member => member.id !== sender.id)
    const userIds = recipients.map(member => member.id)

    await this.sendNotificationsToUsers(userIds, {
      title: 'New Family Message',
      message: `${sender.name}: ${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}`,
      type: 'message',
    })
  }

  // Family announcement notification
  async notifyFamilyAnnouncement(announcement: string, createdBy: any, familyMembers: any[]) {
    // Don't notify the creator
    const recipients = familyMembers.filter(member => member.id !== createdBy.id)
    const userIds = recipients.map(member => member.id)

    await this.sendNotificationsToUsers(userIds, {
      title: 'Family Announcement 📢',
      message: announcement.substring(0, 100),
      type: 'system',
    })
  }
}

export const notificationService = new NotificationService()