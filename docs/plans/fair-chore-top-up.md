# Fair foreground chore top-up — #450 / #134

Source authored 2026-10-24; migration unapplied, flags off, QA deferred. This is
an internal continuation implementation, not evidence of release or performance.

## Contract

The legacy read-side path always selects the first 100 repeating templates. The
new opt-in path visits at most 100 distinct templates per invocation, selecting
owned IDs in ascending order after the household's last attempted position and
wrapping at the end. Under a stable finite set and repeated successful claims,
each series gets an attempt; success or a full window is never inferred from a
cursor. A frequently failing series cannot pin later series behind it.

`ChoreTopUpCursor` stores only `family_id` (primary key, cascading Family FK) and
nullable `after_id`. The position deliberately has no Chore FK: removing a former
anchor does not destroy progression. This is operational metadata, not domain
history, authorization, a completion receipt, public data or AI context.

For each root, a transaction takes the existing household lock, renews household
existence/features and both gates, reads/locks or inserts the cursor, selects the
next owned repeating template excluding this invocation's attempted IDs, then
commits its attempted position. Only then does a separate household-locked
transaction call the canonical expander. That expander re-reads current root,
subject, configuration and ownership and retains its occurrence uniqueness rule.
Effects never update a cursor, so an older delayed effect cannot rewind a newer
claim. Every query value is bound; table names and diagnostics are fixed.

Claim failure stops that invocation without legacy fallback or resetting state.
A root effect failure is isolated and later roots continue. Crash, pause or timeout
after a claim may defer that root until traversal wraps. It does not silently
mark it successful. Concurrent workers can wrap or attempt the same root on
different visits: canonical expansion remains idempotent. There is no claim of
exactly-once execution or immediate household-wide completion.

A monotonic 1,500 ms initiation budget bounds new work, with remaining-time
transaction timeout and at most 200 ms connection wait per transaction. This is
not a measured end-to-end latency bound: driver timeout/rollback/lock behavior,
query count, dense rotations, contention and runtime overhead need PostgreSQL
acceptance. Once-only routine recovery retains its existing separate pass; the
budget is not a whole-request budget. A full routine window still inserts zero.

## Compatibility, privacy and rollout

Both `FAIR_CHORE_TOP_UP_ENABLED=1` and
`FAIR_CHORE_TOP_UP_ROLLBACK_READY=1` are required. Unset/disabled defaults retain
the old first-100 behavior and do not read this table. Missing storage while
enabled fails closed for the new pass; it does not pretend recovery completed.
There is no new client field, API, scheduler, provider or second chore store.

Prepare `database/migration-chore-top-up-cursor.sql` and the additive Prisma
model before any activation. Fixed presence-probed SQL avoids requiring the new
Prisma delegate in old generated clients. An old server may ignore the retained
table; turning the gates off restores the old path, including its known fairness
limit. Rollback does not drop metadata, occurrences or history. Migration/client
compatibility and an exact forward/rollback receipt remain unaccepted.

Only the existing authorized whole-household deletion deletes the cursor,
explicitly before Family deletion; absent-table compatibility is preserved and
query/delete failure aborts. Family cascade is a backstop. Individual account
removal does not erase the household's position. It is excluded from public,
shared-tablet, AI, telemetry and domain export payloads. Logs contain fixed failure
codes only, without household/root IDs or content.

## Deferred acceptance

Serial fake cases are authored for >100 traversal, wrap/deleted position,
per-root failure/retry, budget/gate stops, missing storage and disabled no-query
behavior. Deletion fixtures cover the new metadata. None were run. Real concurrent
claims/effects, process death, deletion/feature races, expired budgets, original
rotation/profile/recurrence rules, schema/old-client compatibility and SQL plans
remain open. Keep #450 and #134 open; no runtime checkbox is satisfied here.
