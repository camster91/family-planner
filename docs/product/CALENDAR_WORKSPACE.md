# Calendar workspace — local candidate #457

The shared dashboard content and top navigation use the desktop window width
with existing responsive gutters. Standalone forms keep their readable width;
contextual event create/edit use the route sheets described in FORM_SHEETS.md.

Cameron's screenshots and requested Apple Calendar principles guide the original
Herewoven presentation: a quiet workspace, compact segmented view controls,
184px source sidebar, subtle hourly separators, sticky weekday/date headers and
a labelled current-date marker. Event titles lead, with restrained source accents;
full source and continuation text remains in accessible labels and event details.
Empty day/week views retain their timed grid and a compact empty notice.

The canonical 24-hour grid, overlap placement, exact instants, bounded fetching,
DST agenda fallback, role checks and source filters remain unchanged. This does
not introduce month view, drag scheduling, all-day inference, provider settings,
or new data APIs. Phone timed grids scroll within their container; the default
phone view remains the existing agenda choice.

Focused tests and mounted-fixture markup previews establish local implementation.
The static browser preview labels fabricated events and system-font fallback;
it is not authenticated Next navigation, production data, full browser-matrix,
font-download or physical Android acceptance. Full build and release gates remain
open. Rollback restores shell/CSS presentation and removes event slot wrappers
while retaining standalone pages, canonical APIs and existing saved records.

## All-day events (UI review item 9)

An event can be marked **All day**. It has days, not a time of day.

**Form.** Create and edit have an "All day" switch above the date. On, the
start time, duration and exact end time are hidden; the date stays, and an
optional "Ends on" day makes a longer event (a trip, a school break). Turning
it off brings the time fields back.

**Storage.** One boolean, `Event.all_day` (default false), plus the same flag
on `EventSeries` so repeats carry it. The instants stay real, so every reader
that only knows start and end keeps working:

| Made by | Start | End |
| --- | --- | --- |
| The app (form, reviewed import, project tasks) | 00:00 of the first day | 23:59 of the last day |
| A subscribed feed (`DATE` values) | 00:00 of the first day | 00:00 after the last day |

Both are in the zone the event was made in: the device's zone for the form, the
household zone for feeds. `allDayDays()` in `src/lib/all-day.ts` turns either
shape back into a first and last calendar day without needing a zone, because
the start is a local midnight. That holds for UTC-10:15 to UTC+13:45; the Line
Islands and American Samoa would land one day off.

**API.** `POST` and `PATCH /api/events` accept `all_day`; every event response
returns it. Field names follow the rest of the event contract (`start_time`,
`event_type`), so it is `all_day`, not `allDay`. Older clients that omit it keep
working: a create is a timed event, and an edit leaves the stored value alone.
Turning it on needs `start_time` and an `end_time` after it in the same
request. The Today board sends `allDay: true` only for all-day events.

**Where it shows.**

- Calendar: all-day events sit in their own strip at the top of the day in
  agenda, day and week views, and lead the day in month view. They say "All
  day" instead of a time and never sit on the hour grid.
- Today (personal, fridge, tablet): all-day events are first, with "All day" in
  the time column and no "Now" tag. Coming up shows them with no time. The kid
  home and the morning summary say "All day" too.

**"At the same time."** An all-day event is never counted as overlapping
anything, in the calendar's overlap panel or in conflict review (the review
still reads the event it was opened for).

**Reminders.** The timing rule is unchanged: a reminder is written when the
event's start falls inside the person's lead time. For an all-day event the
start is the start of its first day, so the lead time counts back from
midnight. The text says "Tomorrow, all day" instead of a clock time.

**Repeats.** An all-day repeat ends at 23:59 of its own last day in the series
zone, so a 23- or 25-hour day never pushes it into the next day.

**Feeds.** A subscribed feed's `DATE`-valued `DTSTART` is imported as all day.
Our own feed exports all-day events as `DTSTART;VALUE=DATE` and
`DTEND;VALUE=DATE` (the day after the last day), so other calendars show them
as all day.

**Not changed.** Smart Add and quick capture still make a timed event when no
time is given. Two-way Google/Microsoft sync keeps its own per-link
`CalendarEventLink.all_day`; events it imports are not flagged on `Event` yet.
Events saved before this change with a 00:00 to 23:59 span stay timed until
someone turns the switch on.

**Rollout.** Apply D1 migration `0025_event_all_day.sql` before deploying. The
live code works with the new column; the new code does not work without it.

## Event duration (#458)
Create/edit offer 15, 30, 45 minutes and 1, 1.5, 2 hours, plus custom whole minutes (1–525600). Duration follows the start and displays the calculated end. Select “Exact end time” to return to manual boundaries with the calculated end populated. Existing records remain in manual mode until duration is explicitly chosen, preserving exact imported/stored seconds and DST fold instants on title-only edits. Duration adds elapsed milliseconds to the canonical start; cross-midnight and DST changes do not alter the requested length. API/database continue storing start_time/end_time only. Existing read-only and role restrictions apply.
