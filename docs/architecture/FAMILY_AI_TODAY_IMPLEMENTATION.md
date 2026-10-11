# Family AI Today broker implementation state

This document records the dormant server-side slice for the retrieval contract
in [`FAMILY_AI_TODAY_CONTRACT.md`](./FAMILY_AI_TODAY_CONTRACT.md). It does not
enable Family AI, add a route, call a provider, change permissions or add a
native capability.

## Implemented

- `src/lib/assistant-today-context.ts` authenticates its expected actor against
  fresh `User` and `Family` rows before invoking the narrow loader.
- `src/lib/assistant-today-loader.ts` uses direct, family-scoped allowlisted
  selects. It never calls the visual Today board, ambient settings/photos or
  weather-capable code. Teen chore SQL is constrained to the authenticated
  actor before projection; parent reads remain household-scoped.
- Child claims and paired/shared-device surfaces return unavailable before any
  database call. A mismatched current role or household returns unavailable.
- The projection uses `normalizeFeatures` followed by `effectiveFeatures` and
  marks feature-off sections as unavailable instead of presenting them as a
  successful empty read.
- Events, chores, dinner, open groceries and use-soon rows are bounded,
  deterministically ordered by the existing Today reader, and projected
  without record IDs, emails, member IDs, provider URLs, notes, descriptions,
  feature blobs or other private fields.
- Teen assignee and dinner-cook labels are reduced to `You` or
  `Another household member`. Parent labels remain the names already visible
  on the person Today board.
- Titles and item text remain data and are bounded by UTF-8 bytes. They are
  never interpolated into instructions. Statuses and inventory date kinds use
  fixed vocabularies.
- The server validates the IANA time zone, derives the local date and rejects
  an advisory client clock more than 24 hours from the server clock. Context
  expiry is 60 seconds from the server timestamp.
- Weather is deliberately not fetched by this dormant broker. The board read
  uses `withWeather: false`, so this slice has no external-network side effect.

## Still gated

- No caller imports this broker yet. The existing assistant route remains
  unchanged and does not receive household context.
- Provider configuration, prompt construction, response validation, action
  proposals, confirmation, idempotency and UI freshness/retry are later
  slices from the contract.
- A future assistant caller must run the existing person authentication and
  paired-device refusal first, then pass authoritative actor claims. A
  shared-device or elevated-device assistant route requires its own reviewed
  contract.
- Real PostgreSQL isolation, route negatives and browser/native evidence are
  release gates for the later activation slice; these unit tests use no live
  database and make no production-readiness claim.
