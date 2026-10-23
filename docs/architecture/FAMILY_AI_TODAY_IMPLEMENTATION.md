# Family AI Today broker implementation state

2026-10-22 source update: quota reservations, private usage/cost reporting and
parent controls are now authored; see [`AI_USAGE_CONTROLS.md`](./AI_USAGE_CONTROLS.md).
Canonical food planning, assistant handoff, optional choice feedback and versioned
evaluation/report code are now authored; see `docs/testing/AI_EVALUATION.md`.
All new gates remain off, schema/cases are unrun, and real semantic observations
plus consolidated QA/release remain open. Earlier dated checkpoints below preserve
their original source boundaries.

## Exact AI source-reference catalog source — 2026-10-22

Explicit Include Today requests may now negotiate
`X-Assistant-References: herewoven.assistant-references.v1` when the new private
`FAMILY_ASSISTANT_REFERENCES_READY=1` gate is on. Existing Today readiness, person
parent/teen auth, paired-device refusal, configured provider and rate gates remain.
Older clients keep the exact v1 reply; new clients accept v1 on rollback. The gate
is off by default and no provider, secret, permission or rollout was activated.

The same allowlisted loader can collect a separate ephemeral server sidecar for
its exact projected Event, Chore, dinner, grocery and use-soon rows. Canonical
IDs, creation/update timestamps, selected Event/Chore generations/epochs and
selected dependencies stay server-side. The v1 provider projection remains free
of canonical IDs/URLs. A distinct untrusted reference block supplies opaque stable
HMAC IDs, kind/row index, observation time and keyed revision. Identity binds the
current person, household, role, token generation, domain and canonical ID, using
a domain-separated application key; these IDs are not credentials or signed write
authority. Rotation/session replacement invalidates their relationship. A complete
bounded slot/catalog match is required; no partial/missing-identity catalog is used.

The reference-aware provider reply must declare context/clarification/general
basis and supply at most8 distinct exact issued refs for context claims, no refs
for the other bases. Typed parsing refuses supplied labels/URLs/arbitrary fields.
After provider latency, actor/config/features/Today lease and both current typed
projection and catalog are renewed. Changed/deleted/recreated identities, selected
revision changes and expired sources withhold the old reply. Unknown/foreign refs
are rejected. Labels and fixed canonical app destinations are built only by the
server after renewal; none come from the model. Meal/inventory links open their
canonical section; event/chore/grocery links open the canonical editor/list.

The chat renders optional EN/ES source links for the latest answer's active
monotonic Today lease. Background/expiry hides the links and asks for refresh.
Navigation uses the owned-draft exit barrier. Citations never get replayed in
chat request messages or become action authority. Normal deterministic controls
and canonical confirmations remain unchanged. Today SQL also excludes erased/
template chores, requires own account namespace for teen work and excludes known
zero-stock use-soon items; unknown quantity is kept explicit by the existing DTO.

Catalog ownership/version/forgery/schema, exact loader sidecar, API source renewal/
unknown refs/legacy compatibility, untrusted provider-block and chat lease cases
are authored and unrun. This is structural reference validation, not proof that
free-form prose correctly reasons from a cited fact. Timestamp/selected-epoch
renewal is not snapshot-wide isolation or a universal legacy-writer ABA guarantee.
Source-generation coverage across remaining domains, source checks at confirmed
planning writes, canonical meal/inventory/recipe planning, versioned semantic eval
scores, household quotas and content-free usage/cost dashboard remain required
#123/#144 code, followed by consolidated QA. No issue is closed.

Only source inspection/edits and selected-file formatting occurred. No tests,
types/lint/build/browser/application API/SQL/DB/schema/client/native/CI, provider/
flag activation, push/merge/deploy or release claim. Full goal stays active.


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
