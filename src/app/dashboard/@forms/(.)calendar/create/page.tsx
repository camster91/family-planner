import { EventCreateSheet } from '@/components/layout/CalendarFormSheets'
import { eventPeopleReady } from '@/lib/event-participants'
export default function Page() { return <EventCreateSheet peopleSupported={eventPeopleReady()} /> }
