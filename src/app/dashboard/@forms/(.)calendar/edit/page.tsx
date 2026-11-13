import { EventEditSheet } from '@/components/layout/CalendarFormSheets'
import { eventPeopleReady } from '@/lib/event-participants'
export default function Page() { return <EventEditSheet peopleSupported={eventPeopleReady()} /> }
