/** Source only; no recurrence expansion or provider/calendar execution. */
import { calendarFeedRule, CalendarFeedInvalidRule } from "../calendar-feed-rule";
it.each([
  "FREQ=DAILY;COUNT=4", "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=1",
  "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
  "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "FREQ=DAILY;UNTIL=20261024T170000Z",
])("preserves supported explicit values and order: %s", rule => {
  expect(calendarFeedRule(rule)).toBe(rule);
  expect(calendarFeedRule("rrule:" + rule.toLowerCase())).toBe(rule);
});
it.each([
  "", " ", "FREQ=DAILY\r\nBEGIN:VEVENT", "FREQ=DAILY\nSUMMARY:Injected",
  "FREQ=DAILY;FREQ=WEEKLY", "COUNT=4", "FREQ=NOTAFREQUENCY", "FREQ=DAILY;",
  "FREQ=DAILY;INTERVAL=0", "FREQ=DAILY;INTERVAL=-2", "FREQ=DAILY;COUNT=0",
  "FREQ=DAILY;COUNT=9007199254740992", "FREQ=DAILY;COUNT=4=5",
  "FREQ=DAILY;COUNT=4;UNTIL=20261024T170000Z", "FREQ=DAILY;X-UNKNOWN=YES",
  "FREQ=WEEKLY;BYDAY=BAD", "FREQ=DAILY;BYHOUR=24", "FREQ=YEARLY;BYMONTH=13",
  "FREQ=MONTHLY;BYMONTHDAY=0", "FREQ=YEARLY;BYYEARDAY=0", "FREQ=YEARLY;BYWEEKNO=0",
  "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=0", "FREQ=DAILY;WKST=BAD", "x".repeat(8193),
])("refuses malformed/ambiguous/unsupported stored structure without echo: %s", raw => {
  try { calendarFeedRule(raw); throw new Error("Fixture unexpectedly accepted"); }
  catch (error) {
    expect(error).toBeInstanceOf(CalendarFeedInvalidRule);
    expect((error as Error).message).toBe("Calendar feed contains an unsupported recurrence rule");
  }
});
