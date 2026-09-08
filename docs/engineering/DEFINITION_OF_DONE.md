# Definition of Done

An issue is not complete because code was written or one build passed. Evidence must match the risk and acceptance criteria.

## Always
- Linked issue objective is satisfied without unrelated scope drift.
- No fake/placeholder household data is presented as real.
- Canonical models/APIs are used or an explicit migration/ADR is included.
- Authorization and privacy implications were reviewed.
- Empty/loading/error/success states are intentional where visible.
- Documentation is updated when behaviour/contracts change.
- PR records exact commands run and observed outcomes.

## Common code gate
Run the applicable baseline:
```bash
npx prisma generate
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
```
If a command cannot run, state the exact blocker. Never substitute an unverified claim.

## UI/UX changes
- Figma/spec/reference is linked for significant flows.
- Representative phone/tablet sizes pass.
- No horizontal overflow/clipped primary actions.
- Primary targets >=44x44 CSS px.
- Keyboard/focus/labels/semantics checked where applicable.
- Reduced-motion and long-text/reflow behaviour checked.
- Light/dark/night and data states covered when relevant.
- Screenshots/recordings show the exact candidate.

## API/data changes
- Request/response validation and machine-readable errors.
- Household/role/device authorization tests.
- Foreign-family/foreign-relation negative cases.
- Pagination for unbounded collections.
- Idempotency/concurrency strategy for retryable/collaborative writes.
- Migration/backfill is rehearsable and compatible with supported old clients.

## Offline/sync changes
- Pending/synced/failed/conflict states are visible.
- Duplicate retry/app restart does not duplicate state.
- Reconnect/network-flap behaviour tested.
- Destructive/sensitive actions are not silently queued when live confirmation is required.

## Android changes
- Capacitor/Gradle build succeeds for relevant changes.
- Install/launch smoke on representative hardware or approved emulator matrix.
- Android back, orientation/window resize, background/foreground and WebView/process restart checked when relevant.
- Permission denial has a usable fallback.
- APK/AAB/server compatibility impact documented.

## Security-sensitive changes
- Two-household isolation suite passes.
- Direct API negative cases pass.
- Logs/analytics contain no prohibited private content.
- Dependency/secret/security scan requirements in the issue are satisfied.

## Release-sensitive changes
- Exact commit/artifact identity recorded.
- Backup/migration/rollback evidence exists when required.
- Passing CI is not production approval; production promotion still requires explicit approval.

## Definition of verified
Use “verified” only for evidence actually observed on the exact candidate. Otherwise use “implemented, awaiting verification” or state the blocker.