# Adaptive member setup — #480 review

Prepared 2026-10-11 against source `9e6ac899`. Original Woven Grove proposal, not accepted journey, interactive prototype, production UI, native evidence or permission change. Continues #128/#143/#133; #480 owns canonical identity implementation and #473 owns client compatibility.

## Editable reference

[Member setup review board](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=71-267), on existing `04 · Composition studies · review` page. All example names are fabricated.

| Review | Node | Size |
|---|---|---|
| Short add-member form | [71:271](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=71-271) | 390 × 844 |
| Parent household overview | [71:305](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=71-305) | 800 × 1280 |
| Shared action attribution | [71:346](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=71-346) | 1280 × 800 |

The phone frame studies form content and rounded presentation; it does not yet depict a dimmed background/keyboard or prove sheet behavior. The parent overview and shared picker are alternate contexts, not consecutive onboarding steps.

## Identity and interaction

1. After creating a household, prompt **Add everyone**. Show the signed-in parent separately from name-only profiles. The first creation slice adds a child by name with a server-derived fixed child role. Do not accept a client-provided role. Email is absent from the required form; no generated address, password, login, mail or automatic invite.
2. A short phone sheet uses Back/Close, a clear save action and optional Finish later. Desktop/tablet uses the same form in a bounded detail pane/sheet beside the household overview. Complex account conversion is a separate flow, not more fields in this form.
3. Display Child profile as read-only context, not a free-text role field. Linked teen/parent account examples use existing verified account rules. Other name-only roles require a separately specified server policy and reviewed linking behavior before controls are exposed. Age/presentation preferences must not grant API rights.
4. Add another person returns to the same short form. Continue to Today works with only the owner or several profiles. Finish later preserves members already saved and leaves unsaved drafts explicitly unsaved.
5. Inviting an account is an optional deliberate action after adding a profile. Linking requires verification by the intended account owner and an explicit stable profile ID. Matching names/emails do not prove identity. Assignments/history remain attached to that profile.
6. A shared picker attributes an already-authorized action. Choosing a parent profile never grants parent privileges. Do not expose private addresses, finances, messages or medical notes; use only allowlisted shared DTO fields. Parent elevation remains a separate fresh session/PIN contract.
7. Archive means history retained and future assignment stopped. Permanent deletion has separate scope, confirmation and privacy semantics. Removing a linked account, leaving a household and deleting an account must not be presented as the same action.

## Draft and recovery contract to implement

- Back/Close with untouched fields closes immediately and restores the launcher focus/scroll. With an unsaved draft, offer Keep editing or Discard; clearly explain that saved members remain. Draft data is scoped to the authorized household and cleared on logout/switch/revocation.
- Finish later is explicit. Do not treat offline, timeout or a pending save as success. While saving, announce progress and prevent a second submit; retain the draft on failure. Do not trap users indefinitely if a request fails.
- Recover after process death only from a scoped persisted draft/retry receipt that can be validated against the current account, household and capabilities. No cross-account local draft leakage. Native Back and keyboard dismissal must be tested separately.
- On uncertain response, replay the same operation identity or read its authoritative result. A retry must not create a second person. A 409 preserves the draft, explains the conflict and refreshes current membership before another deliberate save.
- Name length, Unicode, duplicate display names and long translations must remain readable. Do not silently trim into a different identity. Server validation and field error use the same wording.

## State coverage and implementation mapping

| State | Visible behavior | Evidence still needed |
|---|---|---|
| Ready | Name and child-profile context, Add, Finish later; no email required | Canonical API persistence and return refresh |
| Loading/pending | Announced saving, no repeat submission, preserved fields | Slow request, timeout, replay and native Back |
| Empty | Only signed-in owner; invitation is optional | Fresh onboarding through first useful task |
| Validation/error | Labeled field issue; retain name and child-profile context; Retry when valid | Screen reader, keyboard, server failure |
| Offline/stale | Unsaved/pending state; no fake success | Disconnect, reconnect and process-death recovery |
| Conflict/permission loss | Generic explanation, no foreign identity disclosure, safe refresh | Two households, revoked role/device and direct API negatives |
| Success | Add once, return to updated overview, stable profile ID | No-login/no-mail proof, assignment/history and replay |
| Archive/link/deletion | Separate explained scopes | Retained history, verified conversion and account-erasure regression |

Use existing `FormSheet`/`Dialog` for navigation, focus and backdrop behavior, shared semantic form classes for controls, and the canonical member API/model for data. Extend capabilities before rendering unsupported profile-only identities to old installed clients. Do not repurpose `User.email`, fabricate users or introduce a second profile store.

Figma uses local semantic colors/dimensions and Newsreader/Manrope text styles. Existing `Study / Household region` instances supply member cards. Subscribed Simple Design System Button/Input Field instances supply editable control specimens; typography and root fills are overridden to Woven Grove, while nested library input borders remain study assets. These are not Code Connect mappings or a new production component library. No matching Code Connect files were found in the inspected checkout.

## Verification and remaining work

Observed: 13 editable instances, 49 text layers using only Newsreader/Manrope, no rasterized UI/images, existing foundation variables reused. Screenshot inspection found initial text clipping and action-label wrapping; targeted reflow/width repairs passed final visual inspection. Phone fields and standalone actions are readable; shared action tiles fit one row with 56px action targets. No unrelated existing frames were replaced.

Remaining: interactive keyboard/focus/Back/draft states, actual dimmed sheet context, empty/error/offline/conflict and long-text frames, 430px/desktop/large-tablet adaptations, full measured contrast audit, Cameron journey review, canonical implementation and rendered/physical/native evidence. Privacy review removed an ambiguous editable Role field and distinguished the linked teen account from a name-only child. Static design text is not proof of authorization, accessibility or retry correctness. Those gates remain open under #480/#133/#139.

Next vertical slice: parent-controlled child-profile create/edit/archive API with household isolation, revision/idempotency and privacy DTOs, supported assignment capability and old-client handling, then implement this setup flow against that canonical API. Keep foundation/lifecycle PRs #483/#485/#486 in dependency order and require their original exact-head gates. No dormant table activation or production backfill is implied by this design.
