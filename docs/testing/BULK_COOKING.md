# Multi-dish prep QA (#538)

Spec: `docs/product/BULK_COOKING.md`.

## Verified locally on 2026-10-12

- Prisma generate/validate, typecheck, lint and production build pass.
- Additive migrations run twice against isolated loopback PostgreSQL.
- 19 targeted validation, receipt recovery and real-transaction checks pass.
  Coverage includes atomic multi-dish/slot/receipt commit and rollback, same-key
  replay, reserved versus unplanned consumption, simultaneous final-capacity
  allocations, prepared-state requirement, Delete/Undo consumption relinking,
  next-prep comparison, stale ownership/roles, child ordinary-meal compatibility,
  detach identity and whole-dish grocery scaling/deduplication/prepared refusal.
- Device route inventory tests pass with explicit bulk-route refusals.
- Export, deletion-plan, member-relation and translation checks pass.
- Full unit run: 486 suites / 5,586 tests pass, 55 suites skip their opt-in
  environments. Three existing backup-prune tests fail on this macOS host
  because the Linux script needs GNU `date -d`; no test was weakened or skipped.
  Initial unrelated handoff/morning-summary failures were resolved by removing
  the browser-only NEXT_PUBLIC_APP_URL override from the unit environment.
- Actual production-build browser journey passes: 15 tests including three
  account setup tests, plus EN/light and ES/dark at all six viewport projects.
  Creates two dishes together, marks prepared, records/undoes eaten, changes
  next prep and opens a seeded next-prep draft. Scoped Axe serious/critical,
  44px control and horizontal-overflow checks pass.
- Browser testing discovered and fixed a step-transition double action: Next
  must not submit as the review button appears. Explicit keys and preventDefault
  keep review separate; pre-review native form submit only advances. Browser
  assertions require no POST before explicit Save.
- Independent source review found no remaining concrete blocker after fixes to
  detached identity, child meal edits, grocery/prepared concurrency and reload.

## Reproduce

Use a disposable/loopback PostgreSQL DATABASE_URL and FIXTURES_ALLOW=1. Never
run fixture commands against production. Generate the client and run
`node scripts/migrate.js` before database/browser checks.

```sh
npm run typecheck
npm run lint
RUN_DB_INTEGRATION=1 npm test -- --runInBand src/lib/__tests__/meal-prep.integration.test.ts src/lib/__tests__/meal-batches.test.ts src/components/meals/__tests__/meal-prep-mutation.test.tsx
npm test -- --runInBand
npm run build
npx playwright test e2e/bulk-cooking.spec.ts
```

`RUN_DB_INTEGRATION=1` is opt-in, guarded, and required for the transaction
suite. Browser tests use fabricated fixtures and exact random-prefix cleanup.
Test-only provider keys remain blank. No real household has been altered.

## Remaining release boundaries

Fresh Linux CI, exact-candidate review and production authorization remain
separate from local evidence. This feature has not been merged or deployed.
No physical Android/Apple device, store submission, offline/process-death,
food-safety expiry, scheduler or provider capability is claimed.

Rollback retains additive records. An old server cannot enforce bulk grocery
semantics, so rollback requires reviewing those writes before restoring an old
application image; dropping prep tables is not the rollback path.
