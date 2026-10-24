# Household assistant and feedback — issue #464

## Scope and presentation
Two prominent launchers at the bottom-left of personal dashboard content: Report / Suggest and (parent/teen) AI assistant. The toolbar stays in document flow so it cannot cover household content; phone bottom padding clears the fixed tab bar and safe area. The assistant panel loads only after first opening, keeping its forms, voice hook and action clients out of the initial dashboard download. Closing and reopening preserves the current chat/report draft. Rounded form sheet with Assistant, Report / Suggest and My reports. Shared fridge mode and paired-device pages show neither; changing user/household remounts and clears the in-memory conversation. Focus trapping, Escape, 44px phone / 56px desktop launch targets and pending dismissal prevention reuse Dialog.

## Real actions and boundaries
The planner proposes one typed action, never performs a write. Implemented actions are create events, chores, lists and pinned notes; add a grocery item to the sole grocery list; select and remove an event/chore/list; open an enabled role-allowed section. Users edit proposed titles, event times and note text, then confirm. Deletion requires selecting an actual canonical row and checking a confirmation checkbox; deleting a list cascades its items, and a chore deletion removes only that occurrence. Imported calendar rows are not offered for deletion. List removal choices show type, description, creator and item count; indistinguishable choices are refused until reviewed or renamed in Lists. The adopted confirmation path uses a short-lived server target fingerprint and locked stale/expired-target refusal (`assistant-delete-target.ts`). Legacy callers without required proof are not retroactively protected; optional-path activation and acceptance remain separate.

Every execution calls a fixed existing API with fresh auth/household checks; AI cannot choose URLs, record ids, HTTP methods, roles or secrets. Backend planner checks role and feature gates too, returning null for forbidden tools. Core APIs enforce authorization again. D4 remains parent/teen-only for AI budget; children can report. New tools must join the catalog/schema, UI review, capability matrix and tests before claiming support. Arbitrary app parity, general edits/completion, private/medical/finance/account actions and external invitations/messages are not implemented by chat. Parents can create once/daily/weekly/monthly chores after choosing an actual household assignee. Weekly users review weekday checkboxes; the canonical next-selected-weekday date rule remains internal. The assistant offers the relevant canonical screen for more advanced routine/rotation/picture workflows.

Non-idempotent APIs receive one UI attempt and no automatic retries. A lost/unreadable response consumes the proposal and tells the user to check the app before another attempt. Grocery additions reuse Idempotency-Key. Multiple/absent grocery lists require choosing/creating in Lists instead of guessing or silently creating one. Existing date conversion preserves device-local wall time and rejects gaps/invalid intervals.

## AI and voice

2026-10-20 follow-on source: food and unlinked meal forms now share
`ReviewedDescriptionDraft` for foreground description/review/Apply. Meal parsing
is limited to a free-text name, explicit ISO day/slot/numeric servings; omitted
fields keep the form's current values. It selects no recipe/cook by name and
cannot mark meals cooked/eaten or decrement stock. Save uses the existing atomic
meal-create recovery hook. This is a direct form voice/typed workflow, not a new
assistant chat tool or full app-control parity. EN/ES source tests are authored,
not run; provider/native/microphone and lifecycle acceptance remain separate.

2026-10-20 source addition (#125): personal inventory Add item reuses foreground
browser voice and the separately gated local Android preview in an optional
description disclosure. It proposes explicit EN/ES food fields for Apply, then
uses the existing manual canonical intake/recovery Save. It does not add an
assistant inventory tool or arbitrary app control. Food browser listening is
bounded to 20 seconds and uses app/device language; typed input remains usable
without speech or an AI provider. No automatic submission, background wake,
provider activation, stored audio or physical microphone acceptance is added.
The shared voice hook's existing assistant defaults are retained; food opts into
language/deadline and stale callback guards. The later shared meal draft described above closes the direct-form source gap; chat meal tools remain unsupported.
Uses the existing encrypted household AI configuration or deployment fallback, existing vetted public provider transport, redirect restrictions and 30-second deadline. Chat adds a 1300-token budget and a 64KiB response-body limit; new JSON requests are bounded while streaming. Default chat sends bounded conversation text and viewer-supplied clock/time zone only. The separately gated #123 Today-context extension is off in the initial checkbox state and requires an explicit includeToday request; its role/household renewal, bounded transport, freshness lease and unavailable handling are specified in `docs/architecture/FAMILY_AI_TODAY_CONTRACT.md`. It is not automatic household-data attachment. Structured replies are validated; malformed actions rejected. 30 calls/hour/user. No provider enabled, key created or paid call made by the agent. Parent setup link exposes the existing Settings disclosure through explicit `?setup=ai#ai-capture`; it does not save credentials or change server configuration. Chat requires a configured provider before production use.

Voice starts only on explicit button click using available browser SpeechRecognition / webkitSpeechRecognition. The browser may use its own speech service, disclosed in UI. Transcription fills an editable draft, never automatically sends or executes. Unsupported browsers retain typing; permission/error messages are clear. Close, unmount, tab change and pending requests abort listening and detach callbacks. Physical microphone, Android WebView and real provider acceptance remain separate checks.

Tool design reference: [OpenAI function calling guidance](https://developers.openai.com/api/docs/guides/function-calling). The implementation uses validated JSON proposals through the existing OpenAI-compatible transport, rather than exposing general-purpose execution.

## Private feedback
AppFeedback is a canonical private report table with cascading user/family ownership, kind, title, details, pathname, status received and a scoped request UUID. POST upserts by user/request UUID under actor-user then household locks with renewed current membership/session generation; unchanged retries return the saved receipt. A request ID bound to different normalized kind/title/details/page returns 409 REPORT_REQUEST_CONFLICT without exposing or overwriting the previous report, while another household's replay remains 404. The client retains the exact original key/body across uncertain/malformed-response retry, including its original pathname; editing the report creates a fresh request. A nonempty receipt ID is required before clearing the draft. GET returns only current user/current household, newest 25. Fresh auth, rate limit, strict field/body bounds; no automatic screenshot, query string, public GitHub post, email or third-party transmission. Receipt is proof of storage, not staff review or a fix. My reports displays saved receipts/status. Maintainer triage can read the private database through authorized operational access; no global admin inbox or automatic issue-forwarding exists in this slice.

## Compatibility, validation, rollback
Additive idempotent migration `database/migration-app-feedback.sql` runs in the existing migration runner. Retain data on rollback; remove new host/routes while leaving existing capture and app APIs. Local tests/migrations/browser fixtures do not establish production deployment, provider availability, microphone/device verification or complete app-control parity.

## Original #464 requirement/source map — 2026-10-20

| Original requirement | Current source | Remaining acceptance |
| --- | --- | --- |
| Personal dashboard launchers, rounded tabs and in-memory drafts; no shared-device/fridge host | AssistantHost and keyed dashboard layout; lazily mounted AssistantPanel and shared Dialog | Existing host/role/hide/draft/focus/responsive source; actual six-viewports/device/keyboard proof deferred |
| Existing provider only, text-only default, explicit voice fills draft | Assistant route/capture transport validates schema/body/rate/config; use-voice-draft owns explicit start, stop/error cleanup; Today opt-in remains a separate gated extension | Provider eligibility/real microphone and native OS acceptance remain separate; no activation by this code pass |
| Typed reviewed actions and actual assignee/schedule/removal choices | assistant-actions, fixed action-client and editable panel review call canonical APIs; consumed guard prevents replay after any attempted non-idempotent write; proven preflight refusals retain an editable proposal | Existing role/feature/schema/action/voice/uncertain/isolation cases; actual endpoint and mounted journeys deferred |
| Private own-user reports, stable retry, receipts and own-report list | AppFeedback/API strict schema, owned queries/upsert, bounded body/rate; frozen client request and exact server replay binding now source-wired | Existing private ownership/foreign-replay cases plus new conflict/stale-session/invalid-receipt/exact-body retry source are authored but unrun |
| Honest unsupported/errors and confirmation boundaries | Existing provider/config failure guidance, no automatic action send, explicit deletion target/checkbox, own report receipt rather than staff-review claim | Full integration of unsupported/provider/offline/late/confirmation/focus states and original release gates remains deferred |

The new report changes are bounded retry/authority corrections. They do not
activate AI, send chat to a provider, create a live report, forward externally,
add a scheduler or change report retention. No source/public/UI promise of
arbitrary app-control parity, automatic deletion, external message or purchase.
Original tests/build/browser/provider/store/customer evidence is still required;
new test source is not an executed pass.

#123 remains broader than this catalog: grounded meal-plan/food/schedule journeys
and the six approved conflict/responsibility/weekly-reset/event-prep/review-inbox/
what-changed workflows require their own current implementation reconciliation
and missing canonical code. Existing Today opt-in context and typed actions are
partial source, not evidence that those outcomes or the end-to-end dinner-before-
departure journey are delivered. #144 quality/evaluation/telemetry acceptance and
#567 provider eligibility remain separate. Full goal stays active.
