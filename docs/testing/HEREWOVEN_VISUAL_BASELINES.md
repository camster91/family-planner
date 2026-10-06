# Herewoven visual baseline update

## Scope

Intentional display-rebrand baseline refresh for the landing/auth, parent Today and shared-device surfaces. It does not add Day/Week calendar functionality, relax visual checks or establish real-device readiness.

## Source evidence

- Application source head: `e208c9ae663be7cbb9353e403d42acb1adc2784a`.
- Initial Linux-CI run: `37469114439`; browser journeys/accessibility passed, while visual comparison reported the expected differences from the previous design.
- Candidate regeneration: `37472243650`, using the existing `update_snapshots=true` workflow on the same source head. The run completed successfully.
- All 31 committed Linux baseline paths were preserved. No screenshot masks, pixel tolerances, tests or production source were changed to accept the new images.

## Review accounting

The initial report supplied 25 unique actual/expected/diff triplets plus 25 retries. Independent review approved all 25 intentional changes; retry captures were pixel-identical. The corresponding 25 regenerated candidate images were also pixel-identical to those reviewed captures.

The six additional sequential states—parent-elevation banner, device pairing and device removal, each in landscape and portrait—were inspected separately. Copy and controls remained legible and separated; no blocking visual clipping/overlap was observed. These are synthetic fixture states, not production household data.

Each adopted PNG was checked against the downloaded candidate by SHA256. Private per-image review and adoption receipts remain outside the public source tree.

## Changes and limits

The new identity, palette, typography, content-first layout and auth touch targets account for the intended differences. Existing date/clock masks are test instrumentation. Bounded internal panel scrolling is preserved; static screenshots alone cannot establish scroll interaction, API authorization or accessibility compliance.

The next normal CI comparison must pass against these baselines before merge. Updating expected images is not by itself a green visual suite. Windows screenshots were not used as replacement baselines.
