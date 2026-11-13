import CreateEventForm from "./CreateEventForm";
import { eventPeopleReady } from "@/lib/event-participants";
import { eventRepeatReady } from "@/lib/event-series";

// Read on the server at request time; the client never guesses the capability.
export default function Page() { return <CreateEventForm peopleSupported={eventPeopleReady()} repeatSupported={eventRepeatReady()} /> }
