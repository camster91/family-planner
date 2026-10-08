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

**Implemented allowlist (#162/#135):** personal `list-item.set-checked`, shared-tablet
`device.list-item.set-checked`, shared-tablet `device.list-item.add`, and personal
`list-item.grocery-add` (submitted grocery quick adds). Generic list creation and other candidates
are not queueable. The allowlist is code
(`QUEUEABLE_ACTIONS` in `src/lib/offline-queue.ts`): each entry fixes method, path, parser,
namespace and action version, so the queue never replays an arbitrary request. Never queueable:
deletes, finance (budget, transactions, allowance), chore verification/reward approval,
account/auth/password/PIN, pairing/elevation, invites, exports and medical records.

Personal create server prerequisite (#135): `POST /api/lists/items/create` accepts an optional
`Idempotency-Key` with action `list-item.add`. Its item and completed response are atomic, so
lost responses, overlapping lock takeovers and subsequent item deletion cannot duplicate/resurrect
the original add within record retention. Current session, feature and list ownership checks still
precede replay; no-key clients retain their existing behaviour. This is a backend prerequisite, not
permission to persist generic list notes or an implementation of the personal offline queue.

The device create carries exactly `{ listId, content, actingMemberId }`: a validated canonical list id,
trimmed grocery text of 1–200 characters and unverified member-attribution id. Quantity remains 1;
notes, price, ingredient references, actor names, credentials and arbitrary metadata are excluded.
The existing device route re-checks live device/household/list/member authorization, feature and write
switches on every send. Restored read-cache boards still grant no write permission. The local create
is visible as unconfirmed until the server answers; a failed/conflicted add stays visible with Retry
or Remove, and an in-flight add cannot be discarded. Missing lists refresh choices without removing
the tablet. Removing local intent does not delete a server row; the UI says to check the list before
adding again because a lost response may have followed a committed write.

Each explicit add has a unique operation target. Identical text submitted twice is two deliberate
intents; automatic/manual retries and restart keep the original body, actor and idempotency key.
Create retries never renew the original creation timestamp or replace a rejected reused key. Once
expired (24 hours), check the canonical list and remove the queued add; do not restart its replay
window. The existing 50-operation, bounded-backoff/eight-attempt and seven-day failed/conflict
cleanup limits apply. Device revocation/sign-out of the paired identity purges the reserved queue;
a late initial storage read cannot rehydrate an abandoned queue. Queue text is operational household
shared data, not telemetry; local diagnostic reports continue to exclude payloads and identifiers.

Browser proof covers submitted offline creation, API-only page restart, flapping, committed-response
loss and the original same-key dedupe. This is not fully offline shell loading, physical Android
WebView/process restart or fleet convergence acceptance.

Personal `list-item.grocery-add` v1 fixes POST `/api/lists/items/grocery-add` and carries only
`{ listId, content }` (canonical id, trimmed text of 1–500 characters). It persists only explicitly
submitted grocery/shopping text, never generic list notes, unsubmitted drafts, quantity, price,
attribution names, credentials or extra fields. The strict new route requires a key, current person
session, lists feature, household ownership and current grocery/shopping type before replay, and
rechecks type under the canonical list-row lock. Quantity is 1 and attribution is the signed-in
person. Item and replay response commit atomically through the same canonical writer as the generic
and tablet routes. Device identity cannot authenticate this route.

The Lists grocery detail shows pending/syncing/failed/conflict submitted adds separately from
confirmed items, with Retry/Remove recovery and no actions during an in-flight send. Confirmation
refreshes canonical server props; it never inserts an old replay response, which could describe a
since-deleted item. If the list disappears or changes type, the loaded route and its missing-list
page still expose recovery after a reload without allowing a new grocery add. Removing local
intent never deletes a server item. Unavailable storage is explicitly memory-only and triggers the
common durability warning; a full queue keeps the unsent text. Person sign-out/login/terminal401
purges submitted adds with the existing personal namespace. The immutable key/body/24-hour creation
window, 50-operation cap and seven-day failure cleanup apply to both create actions. Expired or
reused-key creates cannot be retried as a new intent.

Browser proof for the personal queue (`e2e/sync.spec.ts`, phone and fridge projects) covers
submitted offline text, API-only restart, flapping, committed-response loss with same-key replay,
failed retry, deleted-list recovery after reload and sign-out purge with no server add. A paired
browser tablet receives the updated canonical shopping count/version through its normal bounded
version timer without reloading; the board deliberately shows only the oldest five rows, so this
is count/version propagation evidence, not every-item visibility or all collaborative-edit convergence.
The queue/component tests cover memory-only warnings, limits, late persistence, namespace isolation
and immutable expired/reused keys; PostgreSQL tests prove strict-route concurrency and a list type
change during the lock wait. Local captures include pending, failed, missing-list and confirmed states.

Compatibility/rollback: the new route is additive, with no schema change, and old generic create
clients retain their existing behavior. Existing v1 tick/device queue envelopes are unchanged.
Older browser bundles do not understand `list-item.grocery-add` and drop it under the existing
unknown-action policy; do not roll back a client with pending personal adds without first confirming
or locally removing them. Removing only the new route leaves adds visibly failed/recoverable rather
than converting them into generic writes. Fully offline shell loading and native process-death,
lifecycle/orientation, multi-device clock conflict and fleet acceptance remain separate #135 gates.

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
- Tick `payload` holds ids and the desired state only (`{ itemId, checked }`); the parser strips
  everything else. The two explicit grocery-create allowlists above also persist submitted text;
  no other household text is retained.
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
Tick retry keeps the same key (a lost response is still replayed), except after
`IDEMPOTENCY_KEY_REUSED`, which gets a fresh key. Retrying an `EXPIRED` tick counts as a new intent
and restarts its age. Create actions never renew either key or age; expired/reused-key creates must
be checked against canonical state and removed locally.

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
  database, which the §8 purge in [`SHARED_DEVICE.md`](SHARED_DEVICE.md) already deletes. It holds `device.list-item.set-checked` v1 (`{ itemId, checked, actingMemberId }`, sent as
  `PATCH /api/device/lists/items/:id` with the operation id as `Idempotency-Key`, server scope
  `device:<deviceId>`). Each action belongs to one namespace: a person queue refuses and drops device actions, and
  the device queue refuses and drops person actions. Its second action, `device.list-item.add` v1, has the fixed minimal grocery create body and path documented above. The device queue sends through the device client
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

## Local sync support diagnostics (#135)

`OfflineQueue.diagnostics()` returns a fixed, content-free v1 projection for both person and device
queues: current depth, pending/syncing/failed/conflict counts, storage durability, dropped-on-cleanup count,
actual send attempts and completed-send success/failure/conflict counts. Success, failure and conflict
rates are fractions of **completed sends**, not distinct operations or household retention. A retried
operation can contribute multiple sends. A conflict is also a failure; no completed sends means null
rates, not a fabricated 0% success rate. In-flight attempts are not completed outcomes.

The report includes no identifiers (operation, item, member, household or device), paths, desired item
state, timestamps, response/error text, tokens, payloads or household content. Counters remain only in
memory for this queue instance, are bounded to safe integers and reset on sign-out/auth loss, clear,
abandon or disposal. A response already in flight at reset cannot enter the next counter generation.
Counters and reports are not written to queue storage, sent to an API, logged or uploaded.

Help's **Trouble syncing?** section lets an authenticated parent or teen deliberately view their own
already-loaded person queue and copy the report. Reading it never creates a queue, starts a replay,
reads storage or sends a request. An unloaded queue is explicitly unavailable, rather than reported
as healthy. A failed clipboard copy leaves the selectable report on screen. The shared queue has the
same projection internally, but personal Help never reads another person's queue or the device namespace.
This supports local troubleshooting; it does not establish cross-device/fleet telemetry, persistent
historical rates, consent for transmission, native restart acceptance or the rest of #135/#140.

## Grocery field edits and stale-view recovery (#135 follow-up)

Implementation reference for the bounded online editor: use the existing list row and shared Dialog
patterns; persist no editor draft and add no offline edit action. A fresh canonical `updated_at` is
the edit precondition, checked under the existing item row lock. Every real canonical item update
advances this server version even within the same millisecond or if server wall time moves backward;
a no-op tick leaves it unchanged. New editing requests require this precondition and a stable
idempotency key. Existing generic updates and installed tick clients remain compatible.

The editor changes only name/text and whole-number quantity. Pending writes disable editing and
dismissal. A lost response retains the exact body/key for explicit retry; no premature saved claim.
A stale version blocks saving and offers canonical refresh plus an explicit use-current-values
action, while retaining the draft for comparison. A deleted item cannot be recreated by editing.
Use household authentication/feature permissions and the canonical writer; no new schema/provider.
The version is server data, never a client clock or a caller-controlled new timestamp. This advances
the collaborative-field requirement; native and fleet acceptance still need their own evidence.

## Bounded open-list propagation (#135 follow-up)

The personal grocery detail reuses the established board poller's 25-second visible/online checks,
reconnect/visibility wake-up, in-flight suppression, lost-refresh retry and 15-minute full refresh.
Its additive person-only version route returns one opaque digest derived from canonical list/item
IDs and server versions, never item content. Hash the complete sorted membership/version projection:
count plus maximum timestamp alone misses edits to older rows or equal-count replacements during
clock skew. Ownership and list feature checks precede the read; rate limit per member across lists.

Canonical server-page props carry the same digest. Only a changed digest causes a refresh; pending
checkbox intent remains overlaid by the existing queue, while deleted canonical rows disappear.
An open field editor retains its draft and sees refreshed current values, forcing explicit adoption
before another save. Terminal auth/access/missing-list responses stop future checks and refresh the
canonical page. Temporary failures retain the visible snapshot with the existing stale/offline notice.
No background scheduler, full DTO polling, new cached data, draft persistence or schema is introduced.
Item/list versions cover direct grocery membership/field changes; related recipe/member/section labels
also receive the existing slow full refresh. This is browser convergence, not native restart or fleet proof.

The recovery row above uses a previously rendered item. Generic recovery for a deleted queued item
whose list/content is unknown after a full browser restart remains a separate #135 follow-up; no
new title/list context was added to the persisted checked-action payload in this slice.
