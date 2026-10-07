# Review layout follow-ups (#375)

This small follow-up depends on #353. It preserves the current approved identity,
colours, artwork and household data behaviour.

## Decisions

- Login legal links use `inline-block max-w-full`. Each English link stays on
  one line when it fits, while a longer translation can still wrap inside the
  available width. The whole footer remains free to wrap between links.
- Remove the unused `.on-paper` utility and its obsolete artwork instructions.
  A source search found no consumers.
- The Today time column retains its normal 78/96/120px widths but gains an
  em-based minimum width so it can grow when the user enlarges text. The first
  macOS check accepted wrapping, but Linux CI exposed an overflowing clock at
  200% text (107px of content inside a 96px column). The minimum now follows
  the font size instead of leaving the enlarged clock in a fixed-width box.
  The original overflow/separation assertions remain unchanged.

## Validation

The new `e2e/review-layout.spec.ts` exercises the actual login and Today
components with fabricated copy at 100% and 200% text-only scaling. It checks
both legal link targets, no horizontal overflow, the clock column's content
width, and separation between the clock and title. It attaches component
screenshots for visual inspection. The time probe changes only DOM text in the
isolated design gallery; it does not change app data or production fixtures.

Initial local Chromium passed at all six repository viewports, but the Linux
run exposed the clock overflow described above. The corrected candidate needs
fresh local and hosted checks before acceptance. macOS captures were
visually inspected at 390px and 800px. These are layout evidence, not Linux
visual baselines. TypeScript, ESLint, the production build and the affected
auth/contrast/locale Jest suites pass.

Linux references were generated on exact initial head
`d621914c4a2f2fda4e6ea2919c5c1c1af3e53c73` in run 37699779134. Its visual
regeneration step succeeded, while its journey step exposed the 200% clock
bug. Pixel comparison found exactly six changed login images and no other
changed images; every changed pixel lies in the legal footer. Each before/after
was visually inspected: the dot separator becomes "and", and phone links stay
whole across lines. Only these six explained images were adopted. The clock
minimum preserves normal-size layout; fresh combined E2E must verify this.
No masks, thresholds or assertions were weakened.

The integrated candidate retains this PR's commits with the other reviewed
changes and requires fresh checks on its final main base. Production deployment
and physical-device QA remain separate evidence.

Rollback: revert this follow-up. No schema, API, provider or scheduler changes.
