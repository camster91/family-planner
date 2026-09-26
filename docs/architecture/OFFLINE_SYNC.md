# Offline & Sync Contract

Family Planner should remain useful during short home-network outages without creating duplicate or conflicting household state.

## MVP read behaviour
Cache only allowlisted shared-surface data needed for a recent dashboard/detail view. Show the user when data is cached/stale and when it was last synced.

## Offline mutation allowlist
Only explicitly reviewed, low-risk actions may queue offline. Initial candidates:
- grocery check/uncheck;
- grocery quick add;
- other non-destructive quick actions approved by their domain issue.

Do not queue destructive deletion, parent verification/reward approval, security/account changes, sensitive finance/medical actions or other operations requiring fresh server authorization.

**Implemented allowlist (#162):** exactly one action, `list-item.set-checked` (tick/untick a list item, the
grocery proof action). Grocery quick add and other candidates are not queueable yet; each needs its domain
issue, an idempotent route and an entry here. The allowlist is code (`QUEUEABLE_ACTIONS` in
`src/lib/offline-queue.ts`): each entry fixes the method, path, payload parser and version, so the queue can
never replay an arbitrary request. Never queueable, whatever a future issue asks: deletes, finance
(budget, transactions, allowance), chore verification and reward approval, account/auth/password/PIN,
device pairing/elevation, invites, exports and medical records.

## Mutation envelope
Queued operations should include:
- locally generated idempotency key;
- operation type/version;
- authorized actor/device context identifier;
- target ID/version when applicable;
- payload;
- client-created timestamp for UX only;
- retry count/state.

Server time/version is authoritative for ordering and conflicts.

## User-visible states
`pending` -> `syncing` -> `synced`, with explicit `failed` and `conflict` recovery states. Never pretend pending local state is server-confirmed.

## Retry
Use bounded exponential backoff with jitter and network-awareness. App/WebView restart must not duplicate a mutation. Queue size/age must be bounded.

## Conflict policy
Define by domain, not one global last-write-wins:
- grocery toggle may resolve by server version plus undo;
- quantity/text edits use version checks;
- calendar recurrence changes reconcile server-side;
- deletes require live confirmation/tombstone strategy if offline clients can reference them.

## Realtime
Prefer event/realtime delivery or bounded refresh over aggressive polling. Reconnect should reconcile from server authority before replaying dependent actions.

## Security
Shared-device cache excludes sensitive parent-only data. Device revocation blocks future refresh and should clear protected cached state at next contact. Proposed cache namespace, purge triggers and maximum display age: [`SHARED_DEVICE.md`](SHARED_DEVICE.md) §8 (#157).

## Tests
Cover network loss, flapping, duplicate retry, conflict, process restart, queue corruption/limit, stale tombstone, revoked device, and two devices editing the same grocery/list record.

## Implementation (#162)

Code: `src/lib/offline-queue.ts` (queue, allowlist, storage adapters), `src/lib/offline-queue-browser.ts`
(browser wiring), `src/lib/idempotency-key.ts` (key utility), `src/lib/idempotency.ts` (server helper).
Proof action UI: `src/app/dashboard/lists/[listId]/` (person app, Lists → a list). Server semantics of the
`Idempotency-Key` header: [`API_CONTRACTS.md`](API_CONTRACTS.md) "Idempotency".

### Operation envelope (stored on the client)

`{ id, action, v, target, payload, createdAt, state, attempts, nextAttemptAt, lastError }`

- `id` is the idempotency key (random UUID), generated once when the change is queued and sent with every
  attempt, including after a reload or process restart.
- `v` is the per-action operation version (`list-item.set-checked` is v1). The stored container also has a
  schema version (`QUEUE_SCHEMA_VERSION = 1`). An unknown container version, operation version or action,
  malformed data or a duplicate id is dropped on load and the page says "Some changes saved on this device
  could not be kept." There is no migration yet because there is only one version.
- `payload` holds ids and the desired state only (`{ itemId, checked }`); the parser strips everything else,
  so item names and other household text never reach the queue.
- `createdAt` is the client clock, used for display and the age limit only. Server receive order decides.
- `lastError` is a machine code (`NETWORK`, `HTTP_503`, `NOT_FOUND`, `FORBIDDEN`, `EXPIRED`, `MAX_ATTEMPTS`, …),
  never server text.

### States

| State | Meaning | UI (per item, text not colour) |
| --- | --- | --- |
| `pending` | Waiting to be sent (offline, or backing off after a retryable failure). | "Waiting to sync"; the checkbox shows the queued state. |
| `syncing` | Being sent now. | "Syncing…" |
| `synced` | Server confirmed. Removed from the queue immediately. | "Synced" for 3 s. |
| `failed` | Not retryable as is (`HTTP_4xx`, `FORBIDDEN`, `IDEMPOTENCY_KEY_REUSED`), too many attempts (`MAX_ATTEMPTS`) or too old (`EXPIRED`). | "Couldn't sync this change" (or a specific reason) with **Retry** and **Discard**. |
| `conflict` | The target changed so the intent no longer applies: `404` (item removed) or a `409` other than in-progress. | "Not synced: this item was removed" with **Retry** and **Discard**. |

Failed and conflicted operations are never dropped silently: they stay (across reloads) until the person
retries or discards them, or the retention below passes. Discard restores the last server-confirmed state.
Retry keeps the same key (a lost response is still replayed), except after `IDEMPOTENCY_KEY_REUSED`, which gets
a fresh key. Retrying an `EXPIRED` change counts as a new intent and restarts its age.

A newer change to the same item replaces an older one that is not in flight (latest intent wins); if the older
one is in flight, the newer one waits behind it so the server receives them in order.

### Policy numbers (product policy; change `src/lib/offline-queue.ts` and this table together)

| Policy | Value | Why |
| --- | --- | --- |
| Max queued operations (all states) | 50 (`QUEUE_MAX_OPS`) | A household outage, not a data store. At the limit new changes are refused with a visible message; nothing is evicted. Replacing an item's queued intent is still allowed. |
| Max age of a pending operation | 24 h (`QUEUE_MAX_AGE_MS`) | A tick from yesterday is probably stale. Older pending operations stop sending and become `failed` (`EXPIRED`). |
| Retention of failed/conflict operations | 7 days (`QUEUE_RETENTION_MS`) | Matches the server idempotency retention; an older retry could no longer be de-duplicated. Dropped on load and reported. |
| Backoff | 1 s base, doubling, capped at 60 s, equal jitter (50–100% of the step) | Bounded, avoids thundering herd after a router restart. |
| Max attempts | 8 sends per operation | About 2 minutes of retrying while the network is up but the server is not; then `failed` with Retry. Offline time does not consume attempts (nothing is sent while `navigator.onLine` is false). |
| Server record retention | 7 days | `IdempotencyRecord.expires_at`; pruned opportunistically, no cron. |
| Server in-progress lock | 30 s | After that a duplicate may take over an abandoned request. |

### Retry and drain

- One drain at a time per queue (single flight); concurrent triggers share the running drain.
- Triggers: a new change, page load, the `online` event (operations waiting on backoff are tried now; attempt
  counts are kept, so a flapping network cannot exceed the attempt cap), `visibilitychange` to visible, and the
  backoff timer.
- Operations are sent one at a time in queue order. A network failure stops the drain (the rest would fail too).
- Response handling: 2xx → synced; 401 → terminal, the whole queue is dropped; `409 IDEMPOTENCY_IN_PROGRESS`, 408,
  425, 429 and 5xx → retry with backoff; 404 → conflict; other 409 → conflict; 403, 422 and other 4xx → failed.
- An operation that was `syncing` when the page or app died is `pending` again on the next load and is resent
  with the same key; the server replays the stored result if the first send had landed.

### Conflict rule for the proof action

Tick/untick sends the explicit desired state (`checked: true|false`), never a toggle. Two devices converge
by **last write received by the server wins**. Setting an item to the state it already has is a no-op, so a
duplicate, a replay or a second device making the same change keeps the original `checked_by`/`checked_at`.
A late replay of an old key never re-applies it (the stored response is returned). The known cost: an offline
device that reconnects after another person changed the same item overwrites that change; for a grocery tick
the result is visible on both devices and one tap undoes it. Quantity/text edits will need version checks when
they become queueable.

### Storage, scope and security

- Storage: IndexedDB when available (database `fp-sync`, store `kv`), else localStorage, else memory for the
  page. One key per signed-in person: `fp-sync:v1:<userId>:queue`.
- Sign-out (`DashboardNav`) and every visit to `/login` delete the whole `fp-sync:v1:` localStorage namespace and
  the `fp-sync` database, bounded to 1 s so sign-out never hangs. A 401 while draining drops the queue. A
  logged-out or revoked session cannot replay: the server authenticates before it reads any idempotency record.
- Shared device: the queue's device namespace is the reserved `fp-device:v1:queue` key in the `fp-device`
  database, which the §8 purge in [`SHARED_DEVICE.md`](SHARED_DEVICE.md) already deletes. Device writes remain
  disabled; the Lists page queue is person-only.
- One tab is assumed to drain at a time. Two tabs of the same person may both send an operation; the shared key
  makes the server apply it once.
- Full offline reload is not supported yet: the app has no service worker, so a page cannot load without the
  network. The queue survives a reload or restart as long as the page itself can load.

### Tests

- `src/lib/__tests__/offline-queue.test.ts`: allowlist rejection, payload minimisation, state transitions,
  backoff caps and jitter, max attempts, single flight, per-item ordering, bounds, age expiry and retention,
  versioning and corruption, 401 drop, restart persistence (fake-indexeddb and the localStorage fallback),
  logout clearing and the device purge.
- `src/lib/__tests__/idempotency.test.ts`: replay, 422 key reuse, cross-user and cross-household isolation,
  in-progress 409, lock takeover, error release, expiry, pruning and the body cap.
- `src/app/api/lists/__tests__/idempotency.test.ts`: the route on the two-household harness.
- `src/lib/__tests__/idempotency.integration.test.ts` (`RUN_DB_INTEGRATION=1`): concurrent duplicates against
  Postgres run the effect exactly once.
- `e2e/sync.spec.ts`: offline tick → pending → reload → reconnect → synced once; lost response → replay;
  failed with Retry; removed item → conflict with Discard; sign-out drops the queue.
