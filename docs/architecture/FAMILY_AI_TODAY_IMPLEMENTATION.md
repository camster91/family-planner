# Family AI Today broker implementation state

This document records the bounded server and person-chat plumbing slice for the
retrieval contract in [`FAMILY_AI_TODAY_CONTRACT.md`](./FAMILY_AI_TODAY_CONTRACT.md).
The capability remains dormant by default: `ASSISTANT_TODAY_ENABLED` must be
exactly `1` for an explicit person-chat request to include Today context. This
slice does not enable a provider in production, change permissions, add writes
or add a native capability.

## Implemented

- `src/lib/assistant-today-context.ts` revalidates the expected actor and
  household against fresh `User` and `Family` rows before invoking the narrow
  loader. This is an internal database boundary, not request authentication;
  a future caller must authenticate the person session and apply paired-device
  refusal before calling it.
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
  feature blobs or other private fields. Use-soon follows the canonical
  three-day expiry window, fixed status/label vocabulary and use-by exclusion.
- Teen assignee and dinner-cook labels are reduced to `You` or
  `Another household member`. Parent labels remain the names already visible
  on the person Today board.
- Titles and item text remain data and are bounded by UTF-8 bytes. They are
  never interpolated into instructions. Statuses and inventory date kinds use
  fixed vocabularies.
- The server validates the IANA time zone, derives the local date and rejects
  an advisory client clock more than 24 hours from the server clock. Context
  expiry is 60 seconds from the server timestamp.
- Weather is deliberately not fetched by this dormant broker. It does not read
  board snapshots, coordinates or weather-capable code, so this slice has no
  external-network side effect.
- `src/lib/assistant-context-schema.ts` is the strict transport boundary: it
  permits only the bounded Today projection and rejects unknown fields, expired
  envelopes and oversized collections. No IDs, feature blobs or arbitrary
  provider instructions can enter through this shape.
- The existing `/api/assistant` route accepts the additive `includeToday` flag.
  When the server gate is enabled, it authenticates first, loads a fresh
  person-scoped projection, validates it, and sends it as a separate untrusted
  provider content block. The old request and reply shape is unchanged when
  the flag is absent or false. Generated/expiry/protocol headers expose
  freshness without changing the reply JSON.
- `AssistantPanel` exposes an explicit, localized Include Today choice only
  when the server capability is advertised. It retains the draft on an
  unavailable context, displays freshness, and blocks confirmation after
  expiry until the user explicitly requests a fresh preview. Existing action
  routes, receipt/idempotency keys and confirmation controls are unchanged.

## Verification evidence

- The guarded PostgreSQL integration suite
  `src/lib/__tests__/assistant-today-context.integration.test.ts` passed all 10
  tests against the disposable fixture target at commit `5b2cd12`. The cleanup
  readback was zero owned families and zero owned users. This verifies the
  context and loader's database isolation, role filtering, feature-off states,
  local-day boundaries and bounded projection; it does not verify a route,
  browser, native client, provider, or production household.
- The bounded route/provider/schema/panel checks are covered by the focused
  Jest paths under `src/app/api/assistant/__tests__`,
  `src/lib/__tests__/assistant-{provider,context-schema,today-capability,today-context}.test.ts`
  and `src/components/assistant/__tests__/assistant-host.test.tsx`; these use
  fabricated fixtures and provider mocks, not a live provider or household.

## Still gated

- The gate is intentionally off unless the server environment has the exact
  value `ASSISTANT_TODAY_ENABLED=1`; no production flag or provider setting is
  changed by this work.
- This slice has focused route/provider/schema/component unit coverage only.
  Route negatives for child and paired/shared-device refusal still depend on
  the existing authentication boundary; no new device authority is granted.
- Browser/rendered proof, real provider evidence, native/wake integration and
  device capability remain separate release gates. The other 22-feature
  journeys and full Today-board/wake/native surfaces are not accepted by this
  plumbing slice.
