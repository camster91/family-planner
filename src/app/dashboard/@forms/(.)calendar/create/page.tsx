import { EventCreateSheet } from '@/components/layout/CalendarFormSheets'
import { eventPeopleReady } from '@/lib/event-participants'
import { eventRepeatReady } from '@/lib/event-series'
export default function Page() { return <EventCreateSheet peopleSupported={eventPeopleReady()} repeatSupported={eventRepeatReady()} /> }
