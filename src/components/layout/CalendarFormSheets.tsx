'use client'
import { useState } from 'react'
import { useTranslation } from '@/i18n'
import { calendarFormMessages, type CalendarFormMessage } from '@/i18n/calendar-forms'
import CreateEventForm from '@/app/dashboard/calendar/create/CreateEventForm'
import EditEventForm from '@/app/dashboard/calendar/edit/EditEventForm'
import { FormSheet } from './DashboardFormSheets'

function EventSheet({ edit = false, peopleSupported = false }: { edit?: boolean; peopleSupported?: boolean }) {
  const [busy, setBusy] = useState(false)
  const { t } = useTranslation()
  const msg = (key: CalendarFormMessage) => t(key, undefined, calendarFormMessages)
  return <FormSheet title={msg(edit ? 'editEvent' : 'newEvent')} busy={busy}
    closeLabel={msg('closeForm')}
    description={msg(busy ? 'pendingForm' : 'discardDraft')}>
    {edit ? <EditEventForm inSheet onBusyChange={setBusy} peopleSupported={peopleSupported} /> : <CreateEventForm inSheet onBusyChange={setBusy} peopleSupported={peopleSupported} />}
  </FormSheet>
}
export function EventCreateSheet({ peopleSupported = false }: { peopleSupported?: boolean } = {}) { return <EventSheet peopleSupported={peopleSupported} /> }
export function EventEditSheet({ peopleSupported = false }: { peopleSupported?: boolean } = {}) { return <EventSheet edit peopleSupported={peopleSupported} /> }
