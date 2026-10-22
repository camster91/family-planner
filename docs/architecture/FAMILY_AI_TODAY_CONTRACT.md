# Family AI Today retrieval contract

**2026-10-22 source addendum:** the v1 projection below remains the default
privacy/compatibility contract. Optional exact source references now have an
end-to-end source candidate behind explicit client header negotiation and the
default-off `FAMILY_ASSISTANT_REFERENCES_READY` gate; see
[`FAMILY_AI_TODAY_IMPLEMENTATION.md`](./FAMILY_AI_TODAY_IMPLEMENTATION.md).
Canonical record IDs stay server-side; opaque scoped IDs, row indexes and
observation/revision metadata are the separate provider tool-context references.
They grant no write authority. Cases are authored/unrun; no activation, semantic
quality score, snapshot-wide isolation, consolidated QA or release is claimed.


**Status:** design-only contract. This document does not activate a provider,
add a route, change a permission, add a native capability, or claim that the
assistant can act on household records.

**Parent work:** #123/#464, with the cross-device sequence in
[`CROSS_DEVICE_ROADMAP.md`](../product/CROSS_DEVICE_ROADMAP.md) and the current
assistant boundaries in [`AI_ASSISTANT.md`](../product/AI_ASSISTANT.md).

This is the first grounded-context slice for Family AI: answer questions about
the viewer's current Today plan from a small, server-built context. It is
deliberately narrower than a general household search or an app-wide agent.
The provider sees only an allowlisted context assembled after authentication;
the browser and model never choose the household, record IDs, route, method or
provider URL.

## Current source boundary

The existing Today implementation is the source of truth for the initial
context:

- `src/app/dashboard/today/today-board-data.ts` builds `TodayBoardData` with
  explicit family-scoped Prisma selects and the shared-device-safe fields.
  `buildTodayBoard` reads a bounded event/chore window, dinner rows, open
  grocery rows, optional use-soon inventory, and role/feature-filtered links.
- `src/app/dashboard/today/board-snapshot.ts` adds the server `generatedAt`,
  opaque board version, display settings and optional weather. Its person and
  device audiences intentionally have different selects.
- `src/app/dashboard/today/page.tsx` reads the current user and household,
  refreshes recurring series on read, and loads the person board with the
  viewer's role. The page's existing `?mode=fridge` is presentation only and
  must never be treated as device authorization.
- `src/app/api/device/today/route.ts` serves the shared-device audience through
  a device credential. It is not an assistant route and must remain the only
  non-elevated device Today read surface.

The assistant broker follows the same Today field semantics but uses its own
allowlisted reads. It must not call `loadTodayBoard`/`buildTodayBoard`: those
visual reads also load ambient settings/photos and can optionally refresh
weather. `src/lib/assistant-today-loader.ts` selects only the fields needed by
the provider projection, and applies the teen assignee predicate in the
database query before any sibling chore row can enter the projection.

- `src/lib/api-auth.ts` authenticates the person and current household, while
  `src/lib/device-refusal.ts` rejects a live paired-device request before the
  lingering person cookie is read. Any new person assistant request must use
  that same boundary.
- `src/lib/assistant-actions.ts`, `src/app/api/assistant/route.ts` and
  `src/components/assistant/action-client.ts` already constrain replies to
  one validated action and fixed existing routes. They currently send chat
  text and the viewer clock/time zone, not household records. That privacy
  property remains the default until this contract is implemented and gated.
- `src/lib/capture.ts` provides the current bounded server transport: encrypted
  configuration, a vetted public URL check for a family-supplied endpoint,
  redirect refusal, a 30-second deadline and a bounded response body. This
  contract reuses that transport; it does not add a provider or expose a key.

The current board is safe to render to all three person roles because its
fields are already the shared-board contract. That does not mean every field
should be repeated to a model. The assistant context is a stricter projection.

## Contract shape

The first implementation should be an internal server function, not a public
household-data endpoint:

```text
loadAssistantTodayContext({
  userId,
  familyId,
  role,
  serverNow,
  viewerTimeZone,
}) -> AssistantTodayContext | unavailable
```

`POST /api/assistant` may call this function only after its existing auth,
paired-device refusal, role and feature checks. The function must load the
current household itself and must not accept a family ID, member ID, record ID,
role or feature map from the browser. A future native device assistant would
need a separate, explicitly reviewed device route; it may not reuse this
person route.

The provider context is versioned internally as `herewoven.assistant-today.v1`
and has this conceptual shape:

```json
{
  "protocol": "herewoven.assistant-today.v1",
  "generatedAt": "server ISO timestamp",
  "expiresAt": "server ISO timestamp",
  "viewer": {
    "role": "parent or teen",
    "localDate": "YYYY-MM-DD",
    "timeZone": "IANA time-zone identifier"
  },
  "today": {
    "events": [],
    "chores": [],
    "dinner": null,
    "groceries": [],
    "useSoon": [],
    "weather": null
  }
}
```

The exact JSON is an implementation detail until its schema and tests land.
The following rules are binding:

- `generatedAt`, `expiresAt`, `localDate` and the time zone are server-derived
  or server-validated. `viewerTimeZone` must be a valid IANA zone accepted by
  `Intl.DateTimeFormat`; an invalid zone is a clear input error. `localNow` is
  an advisory client clock only. The server computes the actual local date and
  rejects a clock more than 24 hours away rather than answering a fabricated
  past or future day.
- Context is fresh for one provider request and expires after 60 seconds. The
  UI shows the freshness time. A confirmation after expiry refreshes the
  canonical target and creates a new preview; it never executes an old
  context silently.
- Retrieval runs only because the user asks a question or opens a review. It
  adds no cron job, scheduled task, background poll or wake-triggered provider
  call.
- Events contain title, local start/end, task status and a safe source label
  only. Do not include description, location, subscription IDs, connection
  IDs, creator IDs, attendee guesses or arbitrary links.
- Chores contain title, local due day, normalized status and the minimum
  assignee label needed by the role. Do not include points, streaks, private
  descriptions, member IDs or archived/erased profile data.
- Dinner contains the existing board-safe recipe/cook title and prep-minute
  fields. It never includes recipe instructions, meal notes, ingredient names,
  household inventory details or a provider URL.
- Groceries contain the visible item text, quantity and safe list label for the
  bounded open rows already used by Today. They never include item/list IDs,
  creator IDs, notes or hidden checked rows.
- Use-soon contains only the existing board-safe name, place, date kind and
  canonical human expiry state/status. It uses the existing three-day window
  and excludes past use-by rows. It is omitted when the inventory feature is
  off or the read is uncertain. A count or omission is never expanded into
  guessed item details.
- Weather contains only the existing opt-in coarse label and display forecast
  fields. Coordinates, request IPs and provider internals stay server-side.
- The context does not include `links`, `display.photos`, `version`, emails,
  ages, roles of other members, account settings, tokens, credentials, raw
  feature blobs, audit rows, notifications, messages, medical data, locations,
  finance, allowance, rewards, analytics, projects, handoff details or
  arbitrary free-form page content.
- Every list is bounded and deterministically ordered using the same ordering
  as the Today reader. An empty or uncertain result is represented as an
  explicit empty/unknown state, never as “nothing exists” when the read
  failed.

## Role and device policy

| Caller                      | Grounded Today context                                                                                                                                                       | Assistant route                                                                                       | Writes                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Parent person session       | Household-safe Today fields, including member labels already visible on the person Today board                                                                               | Allowed when the existing AI configuration and an explicitly enabled context capability are available | Proposal, review and fresh domain authorization only                      |
| Teen person session         | Own chore detail plus shared operational Today fields; other assignee/member identity is redacted to a neutral label unless the existing board policy explicitly requires it | Allowed under the existing parent/teen assistant rule                                                 | Same review and domain checks; no parent-only action                      |
| Child person session        | None in this slice                                                                                                                                                           | Existing refusal remains; no provider or household read                                               | None                                                                      |
| Paired/shared device        | None through the person assistant route; no assistant launcher or person context in `/api/device/today`                                                                      | Refuse with the existing paired-device policy before person auth                                      | None                                                                      |
| Elevated parent on a device | Not this slice                                                                                                                                                               | No voice shortcut to private dashboard data                                                           | Future device actions require a separate allowlist and elevation contract |

The teen projection is intentionally narrower than the existing board. If
product wants teens to receive the full household board wording, that is a
role-matrix decision and a separate test update; it must not happen implicitly
because the model can see a field in `TodayBoardData`.

The provider receives no context for a child, shared device, invalid household,
missing feature, stale snapshot or failed read. A live paired-device cookie
with a lingering `session_token` is still a refusal, not a fallback to the
person session. Invalid, expired or revoked device credentials retain the
existing ordinary person-auth behavior.

## Provider and prompt-injection contract

- Reuse `resolveCaptureConfig` and the existing `callModel` bounds in
  `src/lib/capture.ts`. No new provider, key, model, paid call, SDK or browser
  secret is introduced by this slice.
- A family-supplied endpoint remains subject to the existing public-address,
  redirect and DNS-rebinding protections. The model response cannot select,
  override or reveal the endpoint, model, authorization header or request
  destination. A response field that looks like a URL is rejected unless it is
  a fixed assistant destination enum.
- The system instruction must say that all titles, item text, event labels,
  weather text and user messages are untrusted data. Any instruction embedded
  in a household record is quoted data, never a command. Delimit the context
  separately from the system rules and user request; do not concatenate raw
  record text into the system instruction.
- The model receives one bounded context and one bounded conversation. It must
  return the existing validated `assistantReplySchema` shape or a dedicated
  versioned extension. Malformed, oversized, multi-action, unknown-destination,
  unknown-ID, arbitrary-URL or provider-error responses become an honest
  unavailable/error state.
- The model must distinguish four answers: a known current record, an empty
  current result, an unavailable/stale result and a suggestion. It may say
  “I can’t verify that right now” and link to Today; it must not turn a missing
  row into “none,” infer a family member, invent a schedule, or claim an
  action happened.
- Retrieval is question-scoped. The initial broker only exposes Today. It does
  not become a general search endpoint, a prompt dump, a tool executor or a
  route proxy. Adding another domain requires a new allowlist row, role matrix,
  schema, source review and isolation tests.

## Command, confirmation and idempotency

Natural language and voice are proposal inputs, not authority.

1. The assistant returns at most one typed proposal using a fixed action kind.
   It never returns a URL, HTTP method, database ID, role, secret or provider
   instruction.
2. The UI displays the exact title, target, date/time, recurrence or
   occurrence scope, feature and affected record summary. It uses the existing
   `Dialog`/assistant review surface, keeps drafts, and requires an explicit
   Confirm button. A wake phrase or transcript never confirms.
3. Before confirmation, the client refreshes any target choices from the
   canonical route. Deletion requires choosing the exact current row; an
   ambiguous title, imported row, foreign row, archived/erased member or stale
   version is refused. The model's wording never identifies a target by ID.
4. The server performs authentication, current household, role, feature,
   ownership and version checks again. UI filtering is not authorization.
5. Every write must have a route-level idempotency contract before the assistant
   advertises it. Reuse the existing `Idempotency-Key` semantics and scope the
   key to the authenticated actor and operation. A same-key replay returns the
   original logical result; a changed body or household is a deterministic
   conflict. Do not retry an unknown outcome automatically.
6. Until event, chore, list, note and deletion routes have the required
   idempotent/receipt behavior, the assistant may propose navigation and
   read-only help, plus only the already-covered grocery operation. A failed
   or unreadable response tells the user to check the canonical screen and
   preserves the draft; it never guesses whether the write happened.
7. Reversible actions may expose an owned Undo only when the canonical route
   provides a receipt and fresh ownership/version proof. A stale proposal
   produces a new preview, never a hidden overwrite.

## Voice, push-to-talk and wake boundaries

The first voice path is the existing foreground editable-transcript flow in
`src/components/assistant/use-voice-draft.ts`:

- The user taps the microphone while the assistant sheet is visible.
- The app shows listening state, captures one bounded utterance, inserts an
  editable draft and waits for the same review/Confirm path as typed input.
- Stop, close, navigation, unmount, denied permission, silence and network
  failure cancel safely and retain the text/manual path. Raw audio is not
  stored by this contract.
- Browser SpeechRecognition remains optional; unsupported browsers keep typing.

Native push-to-talk is a later additive shell capability. It must be measured
on real Android/iPhone/iPad builds and route the resulting transcript into the
same web proposal contract. `readNativeBuildIdentity` in
`src/lib/native-app.ts` is support evidence only; it does not grant a
microphone permission or prove wake support.

Background wake is out of scope for this slice. If a fridge prototype is
approved later, it must be an explicit opt-in local foreground detector while
the dedicated device app is active, with an obvious mic/mute state, bounded
listening window, night/privacy controls and no provider audio before
activation. A wake phrase opens listening; it is never identity, elevation,
permission or confirmation. Android background microphone restrictions and
Apple lifecycle/permission rules are release gates, not assumptions. No
manifest, native permission, service, push registration or wake lock changes
are authorized by this document.

## Failure and offline behavior

| Condition                                                       | Result                                                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Provider not configured or context capability off               | Explain that Family AI is unavailable; Today and manual flows remain usable                         |
| Invalid zone/clock or context stale                             | Do not call the provider; refresh or link to Today                                                  |
| Offline before retrieval                                        | Keep the draft; offer Today's cached/manual surface only if its own cache says it is safe and stale |
| Provider timeout, 429, non-OK or malformed JSON                 | Redacted retryable error; never expose provider body or claim an answer                             |
| Context query fails partially                                   | Mark that section unavailable; do not convert it to an empty result                                 |
| Action response lost/unreadable                                 | Show “check the app”; retain receipt key and do not auto-retry                                      |
| Role, household or paired-device mismatch                       | Refuse before provider access and before returning context                                          |
| App background/process death during listening or pending action | Abort listening/pending request; restore only an editable draft, never a confirmation               |

## Planned implementation slices

Keep these as separate reviewable slices. No step below is implemented by this
document.

### A. Server context broker

Planned files:

- `src/lib/assistant-today-context.ts`: narrow role-aware projection over the
  dedicated loader, with strict time-zone/freshness checks, redaction and
  deterministic bounds.
- `src/lib/assistant-today-loader.ts`: direct, family-scoped allowlisted Today
  selects. It must stay separate from ambient/photo/weather board loading and
  must keep teen chores actor-scoped in SQL.
- `src/lib/assistant-context-schema.ts`: versioned Zod input/output and the
  prompt-safe context envelope. IDs, URLs, feature blobs and private fields
  must be impossible in the provider projection type.
- `src/app/api/assistant/route.ts`: call the broker only after existing auth,
  device refusal, role, feature and provider checks. Preserve the old request
  shape for older clients; advertise a new assistant-context capability only
  after the broker and rollback path are live.
- `src/lib/assistant-actions.ts`: add only fixed, schema-reviewed actions;
  update the capability matrix and prompt together. No arbitrary route/action
  passthrough.
- `src/components/assistant/AssistantPanel.tsx` and
  `src/components/assistant/action-client.ts`: show source/freshness, preserve
  draft/retry state, require review, refresh stale targets and use route
  receipts/idempotency.

### B. Deterministic action safety

Before expanding writes, audit and, where necessary, add additive idempotency
and receipt behavior to the existing event/chore/list/note create/delete paths.
Do not change old clients' request bodies. Add route tests for same-key replay,
changed-body conflict, lost response, stale version, foreign household and
role denial. Keep deletion target selection server-backed and explicit.

### C. Foreground voice

Extend the existing voice-draft tests only after the text/context slice is
stable. Keep transcript editing, explicit submit, close/unmount abort and
permission-denial fallback in `use-voice-draft.ts`. Native push-to-talk is a
separate Android/iOS candidate with its own permission and physical-device
evidence; it is not part of the web contract.

### D. Optional shared-device read-only help

If Cameron approves this separate product decision, add a device-scoped route
using the existing `audience: 'device'` Today DTO or an even smaller projection.
It must not use a person session, show an assistant launcher on a paired
device, expose parent/teen context, or allow writes. Device elevation and any
member attribution need an explicit new contract before action support.

## Required tests and evidence

The first server/UI slice needs all of the following before it can be called
grounded:

- Unit tests for the context schema, deterministic ordering/bounds, invalid
  zone/clock, freshness expiry, empty versus unavailable sections, malicious
  record text and strict role redaction.
- Route tests in `src/app/api/assistant/__tests__/route.test.ts` for parent and
  teen context, child refusal before provider/database access, paired-device
  refusal before person auth, two-household isolation, feature/provider-off,
  provider prompt context, malformed/unknown/arbitrary-URL replies and
  no-provider calls on every refusal path.
- A guarded real-PostgreSQL integration suite for current household reads,
  two-family separation, stale target/version conflict, same-key replay and
  lost-response recovery. It must use fabricated fixture households and leave
  an exact zero-delta cleanup proof.
- Component tests in `src/components/assistant/__tests__` for freshness copy,
  draft retention, review/Confirm, stale refresh, keyboard focus, 44px targets,
  locale switching and the unchanged unsupported-browser voice path.
- A browser matrix at the existing phone, portrait-tablet, fridge-landscape
  and desktop sizes for EN/ES, parent/teen, loading/empty/stale/error/offline
  and long untrusted record text. It must use an intercepted loopback provider,
  assert no unknown mutation or external request, record actual runtime/build
  identity and keep device surfaces free of the person assistant.
- Native push-to-talk/wake tests only in their own candidate: permission
  denial, background/foreground, process death, rotation, network loss,
  transcript editing, no raw-audio retention and no write without Confirm.
  Browser viewport evidence cannot substitute for this.

## Metrics and release gates

Use existing content-minimal telemetry conventions. Record counts and timing,
never prompts, titles, grocery text, names, transcript, provider body, IDs or
coordinates:

- context request outcome by role/surface, feature/provider availability,
  stale/offline/refusal reason and p50/p95 latency;
- answer outcome: grounded, empty, unavailable, malformed, provider timeout or
  prompt-injection refusal;
- proposal outcome: shown, edited, confirmed, canceled, stale conflict,
  permission/role denial, receipt replay and unknown outcome;
- voice outcome: supported, started, transcript produced, canceled, denied,
  unavailable and foreground/background state. Do not claim wake accuracy until
  measured on target hardware.

Release remains blocked until role/device negatives, exact-once writes and
unknown-outcome recovery pass; the provider is configured and paid only by an
owner-approved activation; native permissions and background wake are reviewed
separately. A design document, unit test or host browser run cannot establish
provider availability, microphone behavior, store readiness, household
privacy or market leadership.

## Decisions required before implementation

1. Approve the parent/teen context split above, or choose a different explicit
   role matrix. Children remain out of the assistant slice.
2. Choose whether grounded context is enabled by the existing AI feature gate
   or a new separately kill-switchable capability. Do not enable it by merely
   merging this document.
3. Approve the additive idempotency/receipt work needed before expanding
   non-grocery writes.
4. Decide separately whether a shared fridge gets read-only Today help. Any
   push-to-talk, background wake or microphone permission requires a native
   device/privacy review and physical evidence.
