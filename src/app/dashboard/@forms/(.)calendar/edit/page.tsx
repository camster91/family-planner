import { EventEditSheet } from '@/components/layout/CalendarFormSheets'
import { eventPeopleReady } from '@/lib/event-participants'
import { eventRepeatReady } from '@/lib/event-series'
export default function Page() { return <EventEditSheet peopleSupported={eventPeopleReady()} repeatSupported={eventRepeatReady()} /> }
