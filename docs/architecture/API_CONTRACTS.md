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

## Rate limits
Apply based on abuse/cost/risk rather than one global number. Authentication, invite/recovery, AI, uploads and expensive search/integration routes need stronger controls.

## Provider adapters
Calendar, weather, AI, notification and food/recipe providers must sit behind application interfaces. Provider-specific errors map into stable product states.

## Testing
Contract tests should cover validation, happy path, unauthorized/forbidden, foreign-family IDs, not-found semantics, duplicate retry, concurrency conflict, pagination and old-client fixtures when relevant.