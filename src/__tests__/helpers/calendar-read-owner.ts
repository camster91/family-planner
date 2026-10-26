import { CALENDAR_OWNER_HEADER, CALENDAR_OWNER_PROTOCOL } from "@/lib/calendar-read-owner";
/** Fabricated fixture metadata; never a credential or production household. */
export const calendarReadOwnerFixture = Object.freeze({ protocol: CALENDAR_OWNER_PROTOCOL,
  actorId: "parent-a", familyId: "family-A", role: "parent", generation: 0 });
export const calendarReadOwnerHeaders = () => new Headers({
  [CALENDAR_OWNER_HEADER]: JSON.stringify(calendarReadOwnerFixture),
});
