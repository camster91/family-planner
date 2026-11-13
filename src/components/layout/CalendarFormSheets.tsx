'use client'
import { useState } from 'react'
import { useTranslation } from '@/i18n'
import { calendarFormMessages, type CalendarFormMessage } from '@/i18n/calendar-forms'
import CreateEventForm from '@/app/dashboard/calendar/create/CreateEventForm'
import EditEventForm from '@/app/dashboard/calendar/edit/EditEventForm'
import { FormSheet } from './DashboardFormSheets'

type Capabilities = { peopleSupported?: boolean; repeatSupported?: boolean }
function EventSheet({ edit = false, peopleSupported = false, repeatSupported = false }: { edit?: boolean } & Capabilities) {
  const [busy, setBusy] = useState(false)
  const { t } = useTranslation()
  const msg = (key: CalendarFormMessage) => t(key, undefined, calendarFormMessages)
  return <FormSheet title={msg(edit ? 'editEvent' : 'newEvent')} busy={busy}
    closeLabel={msg('closeForm')}
    description={msg(busy ? 'pendingForm' : 'discardDraft')}>
    {edit ? <EditEventForm inSheet onBusyChange={setBusy} peopleSupported={peopleSupported} repeatSupported={repeatSupported} /> : <CreateEventForm inSheet onBusyChange={setBusy} peopleSupported={peopleSupported} repeatSupported={repeatSupported} />}
  </FormSheet>
}
export function EventCreateSheet(props: Capabilities = {}) { return <EventSheet {...props} /> }
export function EventEditSheet(props: Capabilities = {}) { return <EventSheet edit {...props} /> }
