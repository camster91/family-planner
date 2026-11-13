import EditEventForm from "./EditEventForm";
import { eventPeopleReady } from "@/lib/event-participants";

// Read on the server at request time; the client never guesses the capability.
export default function Page() { return <EditEventForm peopleSupported={eventPeopleReady()} /> }
