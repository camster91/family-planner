# Display-locale follow-ups (#374)

This slice reuses the existing `useDisplayLocale` contract: the app language
(`en` or `es`) plus the first supported device region in that language. The
server and initial hydration use the bare app language; the region applies
after hydration. Locale changes presentation, never date keys, parsing,
time zones, currency denomination or stored household values.

- Kid home event dates/times use that display locale. Today's events remain
  on the viewer's local day. The existing English Today/Tomorrow labels are
  unchanged; this slice does not claim full translation coverage.
- Budget amounts use that display locale with **USD retained**. There is no
  household currency setting. A British device sees `US$1,234.50`, not a
  conversion to pounds or an inferred GBP account currency.
- The pure morning-summary builder accepts an optional `displayLocale`.
  Explicit `en-GB` formats dates day-before-month and times with its clock
  convention while keeping the supplied IANA time zone. Omitting it keeps
  existing compact clock copy and account-delivery behavior.

## Source disposition and remaining contracts

The `weekdayOf` in `src/lib/event-import.ts` is used only in the English AI
provider prompt, not the human import preview. It remains English alongside
that prompt and canonical `YYYY-MM-DD` context. The actual review uses date
inputs; capture-preview dates already use the device locale. No provider,
import API or parsing contract changes are included.

User/Family currently stores no display locale. The production morning-summary
sender therefore supplies no new locale: server personalization needs an
explicit persisted preference contract before it can be wired safely. An
IANA time zone does not establish a locale. No schema, language-storage or
notification-delivery changes are made here, and no summary sends or schedules
are enabled. All seven Hermes jobs remain paused.

Focused regressions cover rendered British kid time, British USD money,
server-to-client regional hydration, explicit summary date/time presentation,
unchanged day keys/role filtering, and omitted-locale compatibility. Exact
candidate command results and rendered release acceptance belong in the PR
and durable completion matrix; this document alone is not completion evidence.
