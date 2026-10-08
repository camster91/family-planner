# Offline & Sync Contract

Family Planner should remain useful during short home-network outages without creating duplicate or conflicting household state.

## MVP read behaviour

Shared-device snapshot behavior is implemented in `device-board-cache.ts` and `use-device-board-snapshot.ts`: see [`SHARED_DEVICE.md`](SHARED_DEVICE.md) §8 for exact allowlist, 24-hour display bound, read-only restoration, revocation and application-shell/native limits. This does not extend the mutation allowlist or establish physical Android acceptance.

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

Food inventory (#263, #158/#121) does not change the allowlist: create, edit, delete, "Used it", "Throw away" and Undo
are online writes with an optional `Idempotency-Key` (a retry never duplicates an adjustment). Offline, the page keeps
the list it loaded and says when it was loaded ("Showing what was loaded at 10:42. Changes need a connection; …"; the
app-wide banner says it is offline), and refuses a write with "You're offline. Connect to the internet to change the
inventory." instead of queueing it.

Store sections (#273) do not change the allowlist: grouping by section runs on the client from the rows and
overrides delivered with the list page, so a queued tick re-renders in its section offline. "Move to…" and the
per-list sorting switch are online writes; the page says a move needs a connection instead of queueing it.

Account and household deletion (D-3, `product/ACCOUNT_DELETION.md`) is never queued: it needs the current password
at the moment it runs. The dialog sends an `Idempotency-Key` and retries once with the same key after a network
error; nothing is stored for later.

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
- While `navigator.onLine` is false no retry timer is armed at all (not even one already due); the `online`
  event resumes the drain. An outage therefore costs no CPU or battery on an always-on tablet.
- Response handling: 2xx → synced; 401 → terminal, the whole queue is dropped; `409 IDEMPOTENCY_IN_PROGRESS`, 408,
  425, 429 and 5xx → retry with backoff; 404 → conflict; other 409 → conflict; 403, 422 and other 4xx → failed.
- An operation that was `syncing` when the page or app died is `pending` again on the next load and is resent
  with the same key; the server replays the stored result if the first send had landed.

### Conflict rule for the proof action

Tick/untick sends the explicit desired state (`checked: true|false`), never a toggle. Two devices converge
by **last write received by the server wins**. Setting an item to the state it already has is a no-op, so a
duplicate, a replay or a second device making the same change keeps the original `checked_by`/`checked_at`.
The compare-and-write is atomic: `src/lib/list-item-update.ts` locks the item row (`SELECT … FOR UPDATE`) in
one transaction, so concurrent requests apply in lock order, each compares against its predecessor's committed
state, and each response is the row exactly as that request left it (proved against Postgres with deliberately
contended opposite updates in `src/lib/__tests__/list-item-update.integration.test.ts`).
A late replay of an old key never re-applies it (the stored response is returned). The known cost: an offline
device that reconnects after another person changed the same item overwrites that change; for a grocery tick
the result is visible on both devices and one tap undoes it. Quantity/text edits will need version checks when
they become queueable.

### Storage, scope and security

- Storage: IndexedDB when available (database `fp-sync`, store `kv`), else localStorage. One key per
  signed-in person: `fp-sync:v1:<userId>:queue`. If the current store later refuses a write (quota, eviction,
  WebView storage error), the whole queue is written to the next store, which becomes current (the failed one
  is cleared best-effort).
- Durability is reported, never assumed: when no store accepts a write, `enqueue` returns `durable: false`,
  `isDurable()` is false and the list page shows "Couldn't save changes on this device. Keep this page open
  until they sync, or they will be lost." The list's offline detail then drops its "saved on this device" wording.
  The changes still sync from memory, and the next successful write makes the queue durable again.
- Sign-out (`DashboardNav`) and every visit to `/login` delete the whole `fp-sync:v1:` localStorage namespace and
  the `fp-sync` database, bounded to 1 s so sign-out never hangs. A 401 while draining drops the queue. A
  logged-out or revoked session cannot replay: the server authenticates before it reads any idempotency record.
- Shared device (#274): the queue's device namespace is the reserved `fp-device:v1:queue` key in the `fp-device`
  database, which the §8 purge in [`SHARED_DEVICE.md`](SHARED_DEVICE.md) already deletes. It holds one action
  only, `device.list-item.set-checked` v1 (`{ itemId, checked, actingMemberId }`, sent as
  `PATCH /api/device/lists/items/:id` with the operation id as `Idempotency-Key`, server scope
  `device:<deviceId>`). Each action belongs to one namespace: a person queue refuses and drops device actions, and
  the device queue refuses and drops person actions. The device queue sends through the device client
  (`getDeviceQueue`, `deviceQueueSend`), so an expired access token is refreshed and retried once, and a revoked
  tablet or the kill switch runs the purge (the queue is abandoned: dropped from memory and never written again, even by an operation still in flight, so the deleted `fp-device` storage is not recreated). It is used only when the
  household turned tablet writes on (§9.2). Chore completes from the tablet are not queued: they are sent once
  with a fresh key and rolled back with a message when offline.
- Board tiles (#274): a person's grocery tick on the Today board uses the same person queue as the Lists page. A
  tick the board queued that ends `failed` or `conflict` is discarded and the item is shown again with an error
  toast; failed ticks queued from the Lists page keep their Retry there.
- One tab is assumed to drain at a time. Two tabs of the same person may both send an operation; the shared key
  makes the server apply it once.
- Full offline reload is not supported: a page still needs the network to load. A navigation that fails
  offline now shows the offline page (below) instead of the browser's error page, but that page carries no
  app data and does not drain the queue. The queue survives a reload or restart as long as the page itself
  can load.

### Tests

- `src/lib/__tests__/offline-queue.test.ts`: no timers while offline (Jest fake timers) and resume on
  `online`, durability reporting and store fallback with failing stores, allowlist rejection, payload minimisation, state transitions,
  backoff caps and jitter, max attempts, single flight, per-item ordering, bounds, age expiry and retention,
  versioning and corruption, 401 drop, restart persistence (fake-indexeddb and the localStorage fallback),
  logout clearing and the device purge; the device variant's path, body, namespaces and 401 drop (#274).
- `src/lib/__tests__/device-queue-send.test.ts`: the device sender maps device-client outcomes (#274).
- `src/lib/__tests__/idempotency.test.ts`: replay, 422 key reuse, cross-user and cross-household isolation,
  in-progress 409, lock takeover, error release, expiry, pruning and the body cap.
- `src/app/api/lists/__tests__/idempotency.test.ts`: the route on the two-household harness.
- `src/lib/__tests__/idempotency.integration.test.ts` (`RUN_DB_INTEGRATION=1`): concurrent duplicates against
  Postgres run the effect exactly once.
- `src/lib/__tests__/list-item-update.integration.test.ts` (`RUN_DB_INTEGRATION=1`): contended opposite ticks
  end in the last received state, each response is its real outcome, and same-state ticks keep attribution.
- `e2e/sync.spec.ts`: offline tick → pending → reload → reconnect → synced once; lost response → replay;
  failed with Retry; removed item → conflict with Discard; sign-out drops the queue.

## Offline banner and offline page (O-41)

Cameron approved (O-41) that the whole app says plainly when it is offline. Two pieces, both deliberately
small; neither caches household data.

**Banner.** `OfflineBanner` (`src/components/ui/offline-banner.tsx`) is mounted once in the dashboard layout
(sticky under the top bar) and once in the shared-tablet layout (`/device/*`, sticky at the top). It reads
`useOnline()` (`src/components/ui/use-online.ts`, the `online` / `offline` events) and shows "You're offline.
Some things may not load or save until you're back online." When the connection returns it says "Back online."
for 3 s, then renders nothing (no height, no layout change). The wrapper is a polite live region
(`aria-live="polite"`, not `role="status"`), so each change is announced once. It is never fixed to the bottom,
so it cannot cover the tab bar. Fridge mode (`/dashboard/today?mode=fridge` and the paired tablet board) hides
it through TodayBoard's chrome CSS (`[data-offline-banner]`), because the board already has its own offline
notice with the time the data was loaded.

**One offline message per page.** The banner is the only thing that says "You're offline". A page under it
adds only what is specific to that page, without repeating that the connection is gone:

| Page | Page-specific offline detail (no "You're offline") |
| --- | --- |
| Lists → a list (`data-testid="list-offline-detail"`) | "You can still tick items. Ticks are saved on this device and sync when you reconnect. 3 waiting to sync." (#162 queue; "Ticks sync when you reconnect." when the queue is not durable). Per-item "Waiting to sync" / "Syncing…" and the queue notices are unchanged. |
| Inventory (`inventory-connection`) | "Showing what was loaded at 10:42. Changes need a connection; the list refreshes when you're back online." The error state says "The inventory loads when you're back online." |
| Calendar, Today board in app mode (`SyncNotice` with `appBanner`) | "Showing what was here 3 min ago. The calendar/board refreshes when the connection returns." |

Fridge mode (`/dashboard/today?mode=fridge` and the paired tablet board) hides the banner, so there the board's
own `SyncNotice` keeps the full "You're offline. Showing what was here …" wording. "Can't reach Family Planner
right now" (online but the server does not answer) is not something the banner says, so pages keep it. A message
answering an action the person just tried (for example "You're offline. Moving an item needs a connection." or the
inventory's refused write) still names the reason: it is the reply to that tap, not a second page notice. Rule in
code: `syncNotice(…, { bannerSaysOffline })` in `src/lib/board-sync.ts`.

**Offline page.** `public/sw.js` is a hand-written service worker, scope `/`:

- Install pre-caches exactly `/offline.html`, `/brand/illustrations/houses-banner.webp` and `/favicon.svg` into
  a versioned cache (`fp-offline-v2`), then `skipWaiting()`. Activate deletes older `fp-offline-*` caches only,
  enables navigation preload and `clients.claim()`s.
- Same-origin GET navigations are network first. Only a network failure (fetch rejects) returns the cached
  `/offline.html`; any server response, including 4xx/5xx and redirects, passes through untouched. The three
  pre-cached files are network first with the cache as fallback. Every other request (all `/api/*`, page
  scripts, other origins, non-GET) is not intercepted at all, and nothing is ever written to the cache after
  install, so no API response and no signed-in HTML is stored.
- `public/offline.html` is self-contained (inline Warm Paper tokens for light and dark, following the saved
  `familyPlanner_theme` like `ThemeProvider`, one inline script, the houses illustration). It says "You're
  offline. Family Planner will reload when you're back online." with a "Try again" button. Both the button and
  the `online` event reload the address that failed (it stays in the address bar). If the browser reports
  online but the page still failed, it says "Can't reach Family Planner right now." instead. `/offline` is a
  rewrite to the same file (`next.config.js`).
- Changing `offline.html` or the pre-cache list: bump `CACHE_VERSION` in `public/sw.js`. `/sw.js` is served
  with `Cache-Control: no-cache`. CSP: `worker-src 'self'` (the policy is still report-only).

**Registration** (`ServiceWorkerRegistration` in the root layout, rules in `src/lib/service-worker.ts`): after
the `load` event, production only, on https or on http for localhost (the E2E server). Never in `next dev`.
Never in the Capacitor Android shell: it loads `https://family.ashbi.ca` through Capacitor's own request proxy,
which injects the native bridge into HTML responses and also routes service-worker requests (Capacitor's
`resolveServiceWorkerRequests`), and that combination has not been tested on a device. In the shell the app
instead unregisters any copy of `/sw.js` it finds. Offline cold start of the Android app is therefore unchanged
(follow-up: test the worker in the WebView, then drop the native exclusion).

**Retiring the worker.** Remove `ServiceWorkerRegistration` from the root layout and replace `public/sw.js` with
a worker whose `activate` handler deletes the `fp-offline-*` caches and calls `self.registration.unregister()`.
Browsers re-check `/sw.js` on navigation, so installed copies remove themselves. Do not just delete the file:
an installed worker keeps running until its script check fails repeatedly.

Tests: `src/components/ui/__tests__/offline-banner.test.tsx` (events, timing, live region),
`src/lib/__tests__/board-sync.test.ts` and `src/components/fridge/__tests__/ambient-sync.test.tsx` (app mode leaves
"You're offline" to the banner, fridge mode keeps it), `src/app/dashboard/lists/[listId]/__tests__/offline-detail.test.tsx`,
`src/lib/__tests__/service-worker.test.ts` (when it registers, native unregister),
`src/lib/__tests__/service-worker-script.test.ts` (runs `public/sw.js` in a sandbox: pre-cache list, old-cache
cleanup, network first, offline fallback, server errors passed through, nothing else intercepted) and
`e2e/offline.spec.ts` (banner offline/back online, tab bar not covered, axe; offline navigation shows the page
and reloads the same address when back online). Every other E2E spec runs with service workers blocked
(`playwright.config.ts`).
