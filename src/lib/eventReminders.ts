import { notificationService } from './notifications'

class EventReminderService {
  // Check for upcoming events and send reminders
  async checkAndSendReminders() {
    try {
      const res = await fetch('/api/reminders/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        console.error('Error checking reminders:', await res.text())
        return
      }

      const data = await res.json()
      console.log(`Sent ${data.immediateCount || 0} immediate and ${data.dailyCount || 0} daily reminders`)
    } catch (err) {
      console.error('Error in checkAndSendReminders:', err)
    }
  }

  // Send reminder for a specific event
  async sendEventReminder(event: any, timeUntil: string) {
    try {
      // Get all family members via API
      const membersRes = await fetch(`/api/family/members?familyId=${event.family_id}`)
      if (!membersRes.ok) {
        console.error('Error getting family members')
        return
      }

      const { members: familyMembers } = await membersRes.json()
      if (!familyMembers || familyMembers.length === 0) return

      const title = `Event Reminder: ${event.title}`
      const message = `"${event.title}" starts in ${timeUntil} (${new Date(event.start_time).toLocaleString()})`

      await notificationService.sendNotificationsToUsers(
        familyMembers.map((member: any) => member.id),
        {
          title,
          message,
          type: 'event',
        }
      )

      console.log(`Sent ${timeUntil} reminder for event: ${event.title}`)
    } catch (err) {
      console.error('Error sending event reminder:', err)
    }
  }

  // Manual reminder trigger (for testing)
  async triggerManualReminder(eventId: string) {
    try {
      const res = await fetch(`/api/reminders/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      })

      return res.ok
    } catch (err) {
      console.error('Error in triggerManualReminder:', err)
      return false
    }
  }

  // Check for overdue chores and send reminders
  async checkOverdueChores() {
    try {
      const res = await fetch('/api/reminders/overdue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        console.error('Error checking overdue chores:', await res.text())
        return
      }

      const data = await res.json()
      console.log(`Sent ${data.count || 0} overdue chore reminders`)
    } catch (err) {
      console.error('Error in checkOverdueChores:', err)
    }
  }

  async sendOverdueChoreReminder(chore: any) {
    try {
      const title = 'Chore Overdue ⏰'
      const message = `"${chore.title}" was due ${new Date(chore.due_date).toLocaleDateString()}. Please complete it soon!`

      // Notify the assigned user
      if (chore.assignee) {
        await notificationService.sendNotification({
          userId: chore.assignee.id,
          title,
          message,
          type: 'chore',
        })
      }

      // Also notify the parent/creator
      if (chore.created_by && chore.assignee?.id !== chore.created_by) {
        await notificationService.sendNotification({
          userId: chore.created_by,
          title: 'Chore Overdue',
          message: `"${chore.title}" assigned to ${chore.assignee?.name || 'someone'} is overdue.`,
          type: 'chore',
        })
      }

      console.log(`Sent overdue reminder for chore: ${chore.title}`)
    } catch (err) {
      console.error('Error sending overdue chore reminder:', err)
    }
  }
}

export const eventReminderService = new EventReminderService()

// Utility function to set up periodic checks
export function setupPeriodicReminders() {
  // Check every 5 minutes (for immediate reminders)
  setInterval(() => {
    eventReminderService.checkAndSendReminders()
    eventReminderService.checkOverdueChores()
  }, 5 * 60 * 1000)

  // Initial check
  eventReminderService.checkAndSendReminders()
  eventReminderService.checkOverdueChores()

  console.log('Periodic reminder checks set up')
}
