# Combined candidate QA (2026-10-07)

Source ancestry and action boundaries: [COMBINED_CANDIDATE.md](../engineering/COMBINED_CANDIDATE.md).
All nine source heads are preserved; held infrastructure #343 is excluded.

## Observed local preparation

- Node 22 frozen install from the merged package lock passed (963 packages).
- Prisma generation, TypeScript and ESLint passed. TypeScript first encountered
  ENOSPC, then passed after removing only this task's generated build output.
- Initial combined full Jest run: 337 suites / 4,194 tests passed; 37 database
  suites / 174 tests skipped by their opt-in guard. Three backup-pruning tests
  failed because macOS lacks GNU date; this same host limitation was already
  seen on main. No tests were removed, skipped or weakened to hide these failures.
- Explicit `RUN_DB_INTEGRATION=1`, `FIXTURES_ALLOW=1` run against disposable
  loopback PostgreSQL 16 passed all 37 database suites / 174 tests. Test process
  exited successfully despite the normal one-second open-handles warning.
- All 30 approved adoption-manifest entries match their recorded SHA-256,
  including public artwork and vendored fonts.

The initial full Jest run preceded the CSS-only font-responsive time correction.
The corrected combined production build passed. The first targeted browser
run failed with ENOSPC while creating its artifact directory and is not a pass;
obsolete task-owned dependency output was removed before a controlled retry.
The retry passed all 27 Chromium checks across all six representative viewports,
including 100%/200% text and clock/title separation; no assertion was weakened.
final Linux CI remains required for all application/container/browser gates.
Do not describe this document as a full green Linux or production acceptance.

## Linux layout finding and reviewed references

The #382 initial Linux journey run caught real clock overflow at 200% text on
an 800px tablet: 107px content in a 96px column. The corrected em-based minimum
preserves normal 78/96/120px widths while allowing enlarged text to grow. The
original overflow/separation assertions remain unchanged.

The visual regeneration step of the same run succeeded. Pixel comparison and
individual before/after inspection found exactly six changed login references,
all changes confined to the legal footer; other references were identical.
[LOGIN_BASELINE_REVIEW_375.json](LOGIN_BASELINE_REVIEW_375.json) records the run,
source/base, changed pixel bounds/counts and adopted image hashes. No mask,
threshold or unrelated reference was changed.

## Retained independent-head evidence

- PR #353: fresh hosted build/E2E/imported-image checks pass; local JDK 21/SDK 36
  host gate passes ten JVM tests, instrumented-test compilation, unsigned APK/AAB
  builds. Physical devices, signing, upload and store acceptance remain absent.
- PR #380: local built Next.js homepage and PNG both returned 200; OG/Twitter
  image metadata agrees, delivered PNG is 1200×630 / 34,331 bytes with SHA-256
  `26a1cf625ba3028f3ce90e90539ec986c1e99690da6af9448c5ec5f228feb11c`.
  Image inspected; local server stopped. Public crawler acceptance is not claimed.
- PR #355: unchanged Tailwind 3 compilation output with parser 6.1.4 and 7.1.6
  was proved on its original code candidate. This does not clear the separate
  unpatched development `sprintf-js` advisory.

Independent-head evidence is not a substitute for final combined-head checks.
No merge, production change, live account mutation or issue closure occurred
from these preparation results. Automatic deployment approval, legal/operator
identity and support address remain unanswered in the goal chat. All original
51 issue criteria remain preserved, including real data/device/beta gates.


## Corrected combined host results

The corrected candidate's production build and 27 Chromium layout checks pass,
including all six viewports at 100% and 200% text. Formatting also passes.
Capacitor sync, all 10 app JVM tests, instrumented-test compilation, and unsigned
release APK/AAB builds pass with explicit JDK 21/SDK 36 and signing variables
removed. Tracked generated settings remain unchanged. No device is connected.

- app-release-unsigned.apk: 6084325 bytes; SHA-256 `842e766072eeb437bf8407e8ba5ef5be2be4cd9f339383c8a7503173c745194e`.
- app-release.aab: 5855433 bytes; SHA-256 `68b1fbfe03a79b4502193d04af6f52ec41b9a51b9295d95806b95ef0d6c4c480`.

These are local unsigned candidates. Final combined-head Linux/container/browser
checks, production approval, device tests and public release acceptance remain
separate; none is inferred from these host results.

## Required 600px reflow coverage (#133)

The acceptance list names 600px, which was missing between the existing 360px
and 768px reflow cases. Added a 600×960 touch-capable window to the same
read-only parent/child suite, retaining the existing horizontal-overflow and
44×44 primary-action assertions. The six standard projects plus custom reflow
widths now include all eleven widths named in #133. This does not prove Android
rotation, split-screen, back navigation or hardware acceptance.

Local focused Chromium run against the unchanged built application and
disposable PostgreSQL fixtures passed: seven 600px journeys plus three auth
setup cases (10 passed, 12.8s). The app server was stopped by Playwright; the
disposable database was stopped afterwards. Full final-head hosted CI remains
required; this focused result is not broad issue closure evidence.
