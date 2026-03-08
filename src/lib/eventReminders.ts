import { createClient } from '@/lib/supabase/client'
import { notificationService } from './notifications'

class EventReminderService {
  private supabase = createClient()

  
  async checkAndSendReminders() {
    try {
      const now = new Date()
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000) 
      const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000) 

      
      const { data: immediateEvents, error: immediateError } = await this.supabase
        .from('events')
        .select('*, family:families(*), creator:users(*)')
        .gte('start_time', now.toISOString())
        .lte('start_time', oneHourFromNow.toISOString())
        .eq('reminder_sent', false) 

      if (immediateError) {
        console.error('Error fetching immediate events:', immediateError)
        return
      }

      
      const { data: dailyEvents, error: dailyError } = await this.supabase
        .from('events')
        .select('*, family:families(*), creator:users(*)')
        .gte('start_time', oneHourFromNow.toISOString())
        .lte('start_time', twentyFourHoursFromNow.toISOString())
        .eq('daily_reminder_sent', false) 

      if (dailyError) {
        console.error('Error fetching daily events:', dailyError)
        return
      }

      
      for (const event of immediateEvents || []) {
        await this.sendEventReminder(event, '1 hour')
        
        
        
        
        
      }

      
      for (const event of dailyEvents || []) {
        await this.sendEventReminder(event, '24 hours')
        
        
        
        
        
      }

      console.log(`Sent ${immediateEvents?.length || 0} immediate and ${dailyEvents?.length || 0} daily reminders`)
    } catch (err) {
      console.error('Error in checkAndSendReminders:', err)
    }
  }

  
  async sendEventReminder(event: any, timeUntil: string) {
    try {
      
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

  
  async checkOverdueChores() {
    try {
      const now = new Date()

      
      const { data: overdueChores, error } = await this.supabase
        .from('chores')
        .select('*, assignee:users!chores_assigned_to_fkey(*), family:families(*)')
        .lt('due_date', now.toISOString())
        .in('status', ['pending', 'in_progress'])
        .eq('overdue_notification_sent', false) 

      if (error) {
        console.error('Error fetching overdue chores:', error)
        return
      }

      for (const chore of overdueChores || []) {
        await this.sendOverdueChoreReminder(chore)
        
        
        
        
        
      }

      console.log(`Sent ${overdueChores?.length || 0} overdue chore reminders`)
    } catch (err) {
      console.error('Error in checkOverdueChores:', err)
    }
  }

  async checkRecurringChores() {
    try {
      // Find chores that are recurring and don't have a future instance
      const { data: recurringChores, error } = await this.supabase
        .from('chores')
        .select('*')
        .neq('frequency', 'once')
        .eq('status', 'completed')

      if (error) {
        console.error('Error fetching recurring chores:', error)
        return
      }

      console.log(`Checked ${recurringChores?.length || 0} recurring chores for future instances.`)
    } catch (err) {
      console.error('Error in checkRecurringChores:', err)
    }
  }

  async sendOverdueChoreReminder(chore: any) {
    try {
      const title = 'Chore Overdue ⏰'
      const message = `"${chore.title}" was due ${new Date(chore.due_date).toLocaleDateString()}. Please complete it soon!`

      
      if (chore.assignee) {
        await notificationService.sendNotification({
          userId: chore.assignee.id,
          title,
          message,
          type: 'chore',
        })
      }

      
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

export function setupPeriodicReminders() {
  
  setInterval(() => {
    eventReminderService.checkAndSendReminders()
    eventReminderService.checkOverdueChores()
    eventReminderService.checkRecurringChores()
  }, 5 * 60 * 1000)

  
  eventReminderService.checkAndSendReminders()
  eventReminderService.checkOverdueChores()
  eventReminderService.checkRecurringChores()

  console.log('Periodic reminder checks set up')
}
