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
Shared-device cache excludes sensitive parent-only data. Device revocation blocks future refresh and should clear protected cached state at next contact.

## Tests
Cover network loss, flapping, duplicate retry, conflict, process restart, queue corruption/limit, stale tombstone, revoked device, and two devices editing the same grocery/list record.