import { createClient } from '@/lib/supabase/client'
import { notificationService } from './notifications'

class EventReminderService {
  private supabase = createClient()

  // Check for upcoming events and send reminders
  async checkAndSendReminders() {
    try {
      const now = new Date()
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000) // 1 hour from now
      const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000) // 24 hours from now

      // Get events starting in the next hour (for immediate reminders)
      const { data: immediateEvents, error: immediateError } = await this.supabase
        .from('events')
        .select('*, family:families(*), creator:users(*)')
        .gte('start_time', now.toISOString())
        .lte('start_time', oneHourFromNow.toISOString())
        .eq('reminder_sent', false) // Assuming we add this field later

      if (immediateError) {
        console.error('Error fetching immediate events:', immediateError)
        return
      }

      // Get events starting in the next 24 hours (for daily reminders)
      const { data: dailyEvents, error: dailyError } = await this.supabase
        .from('events')
        .select('*, family:families(*), creator:users(*)')
        .gte('start_time', oneHourFromNow.toISOString())
        .lte('start_time', twentyFourHoursFromNow.toISOString())
        .eq('daily_reminder_sent', false) // Assuming we add this field later

      if (dailyError) {
        console.error('Error fetching daily events:', dailyError)
        return
      }

      // Send immediate reminders
      for (const event of immediateEvents || []) {
        await this.sendEventReminder(event, '1 hour')
        // Mark reminder as sent (would need to add this field to events table)
        // await this.supabase
        //   .from('events')
        //   .update({ reminder_sent: true })
        //   .eq('id', event.id)
      }

      // Send daily reminders
      for (const event of dailyEvents || []) {
        await this.sendEventReminder(event, '24 hours')
        // Mark daily reminder as sent
        // await this.supabase
        //   .from('events')
        //   .update({ daily_reminder_sent: true })
        //   .eq('id', event.id)
      }

      console.log(`Sent ${immediateEvents?.length || 0} immediate and ${dailyEvents?.length || 0} daily reminders`)
    } catch (err) {
      console.error('Error in checkAndSendReminders:', err)
    }
  }

  // Send reminder for a specific event
  async sendEventReminder(event: any, timeUntil: string) {
    try {
      // Get all family members
      const { data: familyMembers, error: membersError } = await this.supabase
        .from('users')
        .select('*')
        .eq('family_id', event.family_id)

      if (membersError || !familyMembers) {
        console.error('Error getting family members:', membersError)
        return
      }

      const title = `Event Reminder: ${event.title}`
      const message = `"${event.title}" starts in ${timeUntil} (${new Date(event.start_time).toLocaleString()})`

      await notificationService.sendNotificationsToUsers(
        familyMembers.map(member => member.id),
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
      const { data: event, error } = await this.supabase
        .from('events')
        .select('*, family:families(*), creator:users(*)')
        .eq('id', eventId)
        .single()

      if (error || !event) {
        console.error('Error fetching event:', error)
        return false
      }

      await this.sendEventReminder(event, 'now')
      return true
    } catch (err) {
      console.error('Error in triggerManualReminder:', err)
      return false
    }
  }

  // Check for overdue chores and send reminders
  async checkOverdueChores() {
    try {
      const now = new Date()

      // Get overdue chores (due date passed, not completed)
      const { data: overdueChores, error } = await this.supabase
        .from('chores')
        .select('*, assignee:users!chores_assigned_to_fkey(*), family:families(*)')
        .lt('due_date', now.toISOString())
        .in('status', ['pending', 'in_progress'])
        .eq('overdue_notification_sent', false) // Assuming we add this field

      if (error) {
        console.error('Error fetching overdue chores:', error)
        return
      }

      for (const chore of overdueChores || []) {
        await this.sendOverdueChoreReminder(chore)
        // Mark notification as sent
        // await this.supabase
        //   .from('chores')
        //   .update({ overdue_notification_sent: true })
        //   .eq('id', chore.id)
      }

      console.log(`Sent ${overdueChores?.length || 0} overdue chore reminders`)
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