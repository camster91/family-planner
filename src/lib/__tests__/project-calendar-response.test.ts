/** Authored/unrun. A summary is not an exact replay receipt. */
import { projectCalendarSummary, PROJECT_CALENDAR_SUMMARY_PROTOCOL } from "../project-calendar-response";
it.each([
  { state: "created", eventsCreated: 2 },
  { state: "no-tasks", eventsCreated: 0 },
  { state: "all-sent", eventsCreated: 0 },
])("accepts a coherent versioned result", (result) => {
  expect(projectCalendarSummary.safeParse({ protocol: PROJECT_CALENDAR_SUMMARY_PROTOCOL, ...result }).success).toBe(true);
});
it.each([
  { eventsCreated: 2 },
  { state: "created", eventsCreated: 0 },
  { state: "no-tasks", eventsCreated: 1 },
  { state: "all-sent", eventsCreated: -1 },
  { state: "created", eventsCreated: 1.5 },
])("refuses legacy/unversioned or contradictory success bodies", (result) => {
  expect(projectCalendarSummary.safeParse(result).success).toBe(false);
  expect(projectCalendarSummary.safeParse({ protocol: PROJECT_CALENDAR_SUMMARY_PROTOCOL, ...result }).success).toBe(false);
});
