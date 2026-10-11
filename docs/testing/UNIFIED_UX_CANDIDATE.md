# Unified UI/UX integration candidate — 2026-10-11

Parent #128; feature alignment #143; member compatibility #480; installed clients #473.

This candidate brings the pending feature work into one app for integration review. The shared 22-feature coverage contract in `docs/refactor/ROUTE_AND_DOMAIN_INVENTORY.md` defines the remaining per-feature exits; combining these changes does not mark every feature migrated.

## Accepted foundation

PR #494 merged normally into protected main as `a47b7521aaf91c8b3b306e3817e8009a20abb28b` after all original required checks passed and unresolved review conversations were checked. Coolify automatic deployment `snnig2txazufs6paimhisyge` finished at 2026-10-11 03:18:04 UTC. Public `/api/version` returned that exact commit (built at 03:14:19.468 UTC), `/api/health` returned healthy, and the serving container's startup logs showed schema and feature migrations without a startup fatal error. This is release identity, startup and database-health evidence; it does not establish physical-device or real-household acceptance. No production member reconciliation or name-only profile activation was run.

## Integrated scope

The initial integration revision `fa0e4c965404aa57ab441755b409b36e5ebddc49` contains these exact input heads as ancestors:

| PR | Head | Scope |
| --- | --- | --- |
| #495 | 59c8a5579f230403fe7062aeefa079dc7399362a | Member removal, reassignment and Undo |
| #496 | 5dd8340bdf1ed76f048a867d8dd1191d773a0b80 | Chore creation, recurrence and import subjects |
| #489 | 73044ace25d6b99d4b6e3cd00b8b3f73fb0e9655 | Dormant internal profile management |
| #490 | e73ad7e6e4bbc6932bdca239bf85c690decc510b | Public capability and installed-build contract |
| #478 | 3468d57bea84f87b16bbd4f3cce0bc2ff618b83e | Explore and lowercase wordmark |
| #479 | 1e05a013aa1f652e68143203dc12218c5346db41 | Weekly schedule edits |
| #481 | 9a4a8d7b23af45cea4d250428607f03f8a02df1f | Help app details |
| #482 | 8c01efbfe947605226e1d899ce9fb2c5a3fcbb01 | Routine occurrence context and repeat grouping |
| #484 | 77a3af2282e86f5cb7faa700cdd68546090c95f7 | Personal Today deduplication and grid |
| #487 | 3717b344d6eb288f6dc8639c39c22304246f12ed | All-feature UX coverage contract |
| #488 | 3f8a0a11005fcdcc290c918c325a3d01544f4217 | Adaptive member setup design |
| #491 | f9d14c556bd82ea7300bf90308043cd0263184cf | Unknown offline-work retention and recovery |
| #492 | b6790b838c943e5c23c97602013e8c886528799d | Project task draft dismissal |
| #493 | fab5a881641a1ed4f490191221d219e2ad252d11 | Emergency headings and touch targets |
| #497 | 7f82fed6d822a79773b2fc85c4ff86dc437be4c7 | Calendar removal dialogs |

Conflicts retained both behaviors: chore test lock/resolver plumbing plus retained-date reads; both EN/ES diagnostics and routine dictionaries; personal Today tile tests plus offline recovery tests. No original acceptance assertions were removed.

## Initial integration evidence and limits

At `fa0e4c9`, Prisma generation, type checking, lint and production build passed. Seven affected suites passed 102 checks, including guarded disposable PostgreSQL checks and recurrence units. The full unit run passed 5,014 tests; 274 were skipped under existing opt-in conditions. Three established macOS backup-pruning failures remained (430 suites passed, one failed, 42 skipped). This is not an all-green unit result.

Independent source review found no concrete UI integration blocker. The permission review found a chore-verification race using an assignee read before the transaction; that finding must be repaired and checked before candidate acceptance. Source review does not replace rendered evidence. App-details discoverability and same-date routine ordering remain follow-ups.

Deeper feature review also found concurrent feature mutations and refreshes replacing the client map with older responses. The local repair serializes both through one queue, retains optimistic pending changes and the complete server dependency map, preserves the existing single-toggle request payload, and releases the queue after failure. Three focused regression tests, types, ESLint and formatting passed. All three new tests failed against the prior provider; fixed bytes were restored exactly afterward. Final-source integration validation remains required. Browser-native destructive confirmations in lists/chores/anniversaries/handoff/locations and the missing initial-load Retry action in Handoff remain scoped follow-ups.

The chore verification repair now locks and rereads the parent, chore and assignee inside the transaction. Canonical inactive or erased subjects cannot receive a fresh reward through a legacy account fallback. Notifications retain the separate delivery-time locked membership check. Four new race/privacy regressions failed against the prior route; the fixed route was restored. Fifty affected checks, type checking and target lint passed. Fresh combined validation and independent final source review remain required.

The fixture-only chore reconciliation rehearsal currently requires a legacy mapping. An account-link-only profile is refused as unreconciled even though the runtime resolver supports that identity. This rehearsal limitation must be resolved before widening its supported states or claiming complete backfill coverage.

Fresh final-source checks, rendered integration journeys and all original hosted gates remain required. Physical Android/iOS device behavior, store signing/distribution, provider acceptance, name-only profile activation, AI action parity and wake-command feasibility, and measured household usability remain open under the existing roadmap.
