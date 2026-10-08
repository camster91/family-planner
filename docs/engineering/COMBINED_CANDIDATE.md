# Combined Family Planner review candidate (2026-10-07)

This is one integrated review candidate for the existing #128/#84/#377 goal,
not a new roadmap or a completion claim. Main at preparation was
`a80c4753bba6f9aa5f978d4a9cff4ee039f97d44`.

## Source preservation

Every head below is retained as an ancestor through ordinary local Git merges.
No source branch was force-pushed or replaced. The initial combined merge before the Linux layout correction was `a1cc12a8f6c9bb87abf065ced8026c4a3ea6f59e`.

| PR | Retained exact head | Scope |
| --- | --- | --- |
| [#378](https://github.com/camster91/family-planner/pull/378) | `317d23edc8839ed3c2f179e803d0bc97ea2d7bf6` | Canonical completion/release docs |
| [#349](https://github.com/camster91/family-planner/pull/349) | `a62ebb52c8e802dd709ef77aaffeb6b99fc34866` | README |
| [#353](https://github.com/camster91/family-planner/pull/353) | `5ee752e0da66dfee1dc60f0249ec008785a988a0` | Launch review, display locale, offline copy and Undo clearance |
| [#382](https://github.com/camster91/family-planner/pull/382) | `bd98e3675b668a1529075c91d17b10a34c5c6968` | Login legal-link reflow, reviewed Linux baselines, font-responsive time column and 200% text checks |
| [#381](https://github.com/camster91/family-planner/pull/381) | `dbadd5c8010648076a8184afd850c2b5dae5bf5e` | Kid/budget locale display and optional summary presentation |
| [#380](https://github.com/camster91/family-planner/pull/380) | `b0ec3acfa5440f7c02695dbbbd7c6591594c7147` | Approved-source social preview |
| [#351](https://github.com/camster91/family-planner/pull/351) | `ff76f714d798b4de7210fafd05a8a07aab8f729a` | Runtime dependency patches |
| [#352](https://github.com/camster91/family-planner/pull/352) | `10ff777dc68b07d38ec4c21fd9a5840f78f7ce19` | Development dependency patches |
| [#343](https://github.com/camster91/family-planner/pull/343) | `f4ce340f8dc1d2823927129ba40bbc2a2509f95d` | Add existing Coolify network while retaining current database/storage; migration preparation only |
| [#355](https://github.com/camster91/family-planner/pull/355) | `4629313fb92cd4a390fbded0689168f482436ac7` | Tailwind 3 retained; selector-parser security override |

Cameron subsequently instructed “merge all” after the automatic-deployment question. PR #343 network preparation is now included as an ancestor; a live database cutover remains separately gated. Prisma source/migrations
are unchanged relative to main. No production settings, credentials, providers,
schedulers, legal/operator identity, support mailbox, real account data,
destructive migration, beta outreach or signing/store action is included.

## Verification and action

Individual-head evidence remains in the source PRs and existing programme
issues. The combined candidate requires fresh checks against its final head:
frozen install, Prisma, TypeScript, lint, tests/database checks, production
build, container/imported-image checks, and rendered browser/visual checks.
Android host tests/build and device limitations must be recorded separately.
Never use individual-head green checks as proof of the integrated build.

Linux login baselines from the #382 branch are eligible only after visual review
and pixel comparison. Adopt only explained differences. Full combined E2E must
then pass without weakening assertions, masks or tolerances.

Cameron's latest “merge all” instruction answers the pending question about existing automatic Coolify deployments for these reviewed, tested PRs. It authorizes the normal protected combined merge including #343's additive network preparation, followed by source PR reconciliation and cleanup. It does not authorize a database cutover, credential/settings change, destructive migration, provider/scheduler activation or store publication. Only merge after the final combined head passes required and applicable checks; preserve all source ancestry through an ordinary merge commit.

After authorized protected merge, verify the actual main source/runtime
relationship, health and approved asset delivery, then reconcile each source
PR's current status. Only remove branches that are demonstrably incorporated;
preserve unrelated or held work. #382 may need retargeting from its stacked
base to main before GitHub recognizes incorporation. Do not mark a source PR
merged or an issue complete unless current GitHub/runtime evidence proves it.

Rollback is the normal protected revert of the combined merge, with previous
healthy source/runtime evidence retained. The production path remains the
existing Coolify source build; no immutable-image promotion is claimed.
