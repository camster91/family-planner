# Review layout follow-ups (#375)

This small follow-up depends on #353. It preserves the current approved identity,
colours, artwork and household data behaviour.

## Decisions

- Login legal links use `inline-block max-w-full`. Each English link stays on
  one line when it fits, while a longer translation can still wrap inside the
  available width. The whole footer remains free to wrap between links.
- Remove the unused `.on-paper` utility and its obsolete artwork instructions.
  A source search found no consumers.
- Keep the Today time column unchanged. At 390px and text-only 200% zoom,
  `Until 10:30 PM` occupies three lines. This is intentional reflow: the full
  time remains visible, the event title remains visible alongside it, and no
  content overlaps or overflows. Widening this column would take space from
  long event titles. At normal text size the clock stays together below Until.

## Validation

The new `e2e/review-layout.spec.ts` exercises the actual login and Today
components with fabricated copy at 100% and 200% text-only scaling. It checks
both legal link targets, no horizontal overflow, the clock column's content
width, and separation between the clock and title. It attaches component
screenshots for visual inspection. The time probe changes only DOM text in the
isolated design gallery; it does not change app data or production fixtures.

Local Chromium passes at all six repository viewports. macOS captures were
visually inspected at 390px and 800px. These are layout evidence, not Linux
visual baselines. TypeScript, ESLint, the production build and the affected
auth/contrast/locale Jest suites pass.

Before merging, obtain and inspect Linux login baselines from the E2E workflow
on this exact branch. Adopt only deliberate login changes; unrelated screenshot
changes must be investigated. Retarget the stacked PR to main after #353 merges
and require fresh checks against that base. Production deployment and device QA
remain separate evidence.

Rollback: revert this follow-up. No schema, API, provider or scheduler changes.
