# API Contracts

The Android app and deployed server can be on different versions. API changes must be compatible, typed and observable.

## Contract rules
- Validate request payloads at the boundary with Zod or equivalent.
- Return stable DTOs rather than leaking incidental Prisma shape when a mobile/shared contract is involved.
- Use a consistent error envelope with machine-readable code, human-safe message and request ID where available.
- Paginate all potentially unbounded collections.
- Use server-authoritative timestamps.
- Define timezone/date-only semantics explicitly.
- Retryable mutations use idempotency keys.
- Collaborative edits use version/ETag/updated-at conflict checks where necessary.
- Destructive or sensitive actions should require a live server decision.

## Compatibility
Prefer additive API changes. Do not remove/rename required fields or change semantics until supported installed clients no longer depend on them.

For breaking changes, define:
1. old-client behaviour;
2. compatibility window;
3. server rollout order;
4. client rollout order;
5. feature flag/kill switch;
6. rollback behaviour.

## Error shape target
A future normalized form may look like:
```json
{
  "error": {
    "code": "HOUSEHOLD_FORBIDDEN",
    "message": "You do not have access to this item.",
    "requestId": "...",
    "retryable": false
  }
}
```
Do not expose stack traces, database details, foreign record existence or secrets to clients.

## Idempotency
Client-generated keys should be scoped to authenticated actor/device + operation. Replays should return the prior logical result or a deterministic conflict, never duplicate visible state.

Implemented in #162 (`src/lib/idempotency.ts`, record `IdempotencyRecord`). Routes that accept it today:
`PATCH /api/lists/items/update`. Queue policy and client behaviour: [`OFFLINE_SYNC.md`](OFFLINE_SYNC.md).

- **Header:** `Idempotency-Key: <key>`, optional. 16–128 characters of `[A-Za-z0-9_-]`; clients send a random
  UUID generated once per logical change and reused for every retry of it. Without the header the route
  behaves exactly as before (older clients need no change).
- **Order of checks:** authentication (401) → key format (400) → body validation (400) → idempotency → the
  route's own household/role checks. A signed-out or revoked session therefore never reaches a stored response.
- **Scope:** records are unique per `(scope, key)`, where `scope` is `user:<userId>` for a person session
  (`device:<deviceId>` is reserved; device writes are not enabled). The same key from another user is a
  different record. A record is only replayed to the household it was written in.
- **Request identity:** a SHA-256 of the action name and the validated body in canonical (key-sorted) JSON.
  The body itself is not stored.
- **Outcomes:**

| Situation | Response |
| --- | --- |
| First request with a new key | The route runs; a 2xx result is stored (status + body up to 8 KB, else `{ "success": true }`). |
| Same key, same request, first one finished | The stored status and body, with `Idempotency-Replayed: true`. The effect does not run again. |
| Same key, same request, first one still running | `409` `IDEMPOTENCY_IN_PROGRESS`, `retryable: true`, `Retry-After: 1`. |
| Same key, different body, action or household | `422` `IDEMPOTENCY_KEY_REUSED`, `retryable: false`. |
| Malformed key | `400` `IDEMPOTENCY_KEY_INVALID`. |
| First request ended non-2xx or threw | Nothing is stored; the same key may be retried. |
| First request died mid-flight (row in progress for more than 30 s) | The next request with the key takes over and runs the route again (allowlisted actions converge). |
| Record older than 7 days | Treated as absent; the key starts over. |

- **Error shape:** the three codes above use the target envelope `{ "error": { "code", "message", "retryable" } }`
  with `Cache-Control: private, no-store`. The route's existing errors keep their current shape.
- **Retention:** `expires_at = created_at + 7 days`. A small random share (5%) of keyed requests deletes expired
  rows; there is no scheduled job. Rows cascade away with their household or user.
- **Concurrency:** the in-progress row is inserted before the effect runs, so the unique index serialises
  concurrent duplicates (proved against Postgres in `src/lib/__tests__/idempotency.integration.test.ts`).

## Rate limits
Apply based on abuse/cost/risk rather than one global number. Authentication, invite/recovery, AI, uploads and expensive search/integration routes need stronger controls.

## Shared-device routes (#157 contract, #240)
Implemented (behind `SHARED_DEVICE_ENABLED`, default off; every route is `404` while it is off); UI and device writes are not. The endpoint table, error codes (`DEVICE_ACCESS_EXPIRED`, `DEVICE_REVOKED`, `DEVICE_SESSION_INVALID`, `ELEVATION_REQUIRED`, `ELEVATION_EXPIRED`, `PAIRING_CODE_INVALID`, …) and compatibility plan are in [`SHARED_DEVICE.md`](SHARED_DEVICE.md) §12–§13. New device routes use the target error envelope above and `Cache-Control: private, no-store`; they live under `/api/device/*` and `/api/family/devices/*` so existing routes keep their current responses and remain person-only. Installed Android builds need no update because the device UI is served by the web layer.

## Provider adapters
Calendar, weather, AI, notification and food/recipe providers must sit behind application interfaces. Provider-specific errors map into stable product states.

## Testing
Contract tests should cover validation, happy path, unauthorized/forbidden, foreign-family IDs, not-found semantics, duplicate retry, concurrency conflict, pagination and old-client fixtures when relevant.