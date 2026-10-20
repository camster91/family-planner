# Reviewed food capture (#125)

## Current source candidate — 2026-10-19

The full approved target remains barcode/photo identification → editable review →
canonical inventory → consume/discard/cook/owned Undo → recipe/prep/restocking
reuse. An intake endpoint is a reliability foundation, not completion of barcode
or product-database capture. Paid services, product-data licensing, age/privacy
eligibility, native camera acceptance and rollout remain explicit dependencies.

| Requirement | Current source state | Next work / evidence |
| --- | --- | --- |
| Canonical reviewed save | New GET/POST `/api/inventory/intake` with current person/household/session/role/inventory authority; same-family Ingredient resolution | Source candidate; disposable-DB/API/role/isolation QA deferred |
| Exact response recovery | Canonical InventoryItem + compact itemId receipt commit atomically, live replay checks existence, issued-at bounds abandoned intent after receipt expiry | Source tests written, not run; no deleted-row recreation |
| Photo suggestion review | Existing parent-only provider-gated scan now sends reviewed rows to intake and keeps exact request/values after unknown outcomes | EN/ES state, partial save and lifecycle source updated; mounted/native QA pending |
| Manual item form | Existing legacy POST/PATCH paths retained | Migrate new creates to the same intake contract, preserve edit/adjustment semantics and recovery |
| Barcode identification | Not implemented by this intake change | UPC/EAN validation/normalization, deliberate camera + typed fallback, duplicate-frame suppression and review tray |
| Public product lookup | Candidate only, no adapter activated | Current official cost/coverage/limits/license assessment; bounded fixed-host adapter; no private stock/date/photo transmission |
| Private product corrections | Not implemented by this intake change | Additive canonical household-owned schema, export/erasure and explicit reuse policy |
| Package/label/date photo | Existing fridge scan only; dates stay unknown until entered | Focused label/date capture, date-kind confirmation and source confidence; no food-safety inference |
| Stock lifecycle | Existing InventoryItem/InventoryAdjustment consume/discard/Undo and cook suggestions | Reconcile atomic authorization/recovery and unit/matching confidence; no model-driven stock decrement |
| Cross-device/offline | No new intake queue/manifest action advertised | #135/#473 compatibility, unsupported/offline draft recovery and actual native lifecycle proof |
| Provider/model eligibility | #567 retains its dependency | No paid/Gemini activation, raw-media retention or external household processing added |

## Intake contract

`GET /api/inventory/intake` returns only current user/family context to personal
parents/teens with inventory enabled. POST requires a strict known v1 envelope,
expected actor/family, issued-at, reviewed item fields and Idempotency-Key. It
stream-bounds JSON to 8 KiB and permits 60 requests/minute/user. Paired sessions
are refused. Every response is private/no-store.

The write takes User → household → receipt locks, renews role/session/feature
checks and resolves a same-family ingredient before creating canonical stock.
The stock row and compact `{itemId}` receipt commit in one transaction. Complete
replays renew authority and current owned existence, never recreating a removed
item or returning stale quantities/dates as live truth. An unexecuted intent more
than the receipt TTL minus one hour old (or >one-minute future clock skew) is
refused, preventing a pruned receipt from making an old request new again.
Different deliberate keys create distinct stock rows; this path never silently
merges amounts, units, locations or dated packages.

The dedicated endpoint prevents rollback to a legacy header-ignorant create.
There is no fallback to `POST /api/inventory`. Older servers without intake leave
the draft/retry unavailable, rather than silently using a different write path.
No schema/model change is needed for this foundation. Legacy create callers
retain their original endpoint; their safety is not retroactively upgraded.

## Photo review ownership

The server-rendered personal inventory page supplies its original actor/family
context. Standalone capture can read context through intake before taking a
photo. A later account/family/role change is refused by fresh server authority;
no automatic rebase moves the reviewed stock to a different household.

Each reviewed row owns one serialized intent/key after its first attempt. An
unknown result freezes inclusion and editable fields, keeps the original body
through later refusal, and blocks Close/Back/new-photo replacement while its
confirmation is unresolved. Successful rows leave the tray; partial counts keep
already-added rows distinct from failed/unconfirmed rows. A known original-item
removal is shown explicitly; re-adding requires a deliberate new selection/key.
Initial definite refusal retains editable data and permits a deliberate corrected
attempt. The former “probably added, untick and replace key” behavior is removed.

Client intake waiting is bounded to 15 seconds, context to 10 seconds. Photo
requests have a separate 60-second client bound, abort/generation cleanup and
bounded suggestion validation. No new photo/audio storage or provider is added;
the existing deployment-controlled scanner remains the only photo service and
is off without its configuration. Raw media stays in the existing transient
review path. Actual permission, memory/lifecycle and native behavior are unproved.

## Candidate evidence and boundaries

Focused source covers concurrent recovery, stock/receipt rollback, deleted-row
replay, actor/family/token/role/expiry refusal, immutable client body/key, malformed
success and locked photo-row retry. Existing scan fixtures use the v1 receipt
and server-page context. These tests are authored, not executed. No tests/type/
lint/build/browser/native run, schema operation, provider call, account mutation,
push, merge or deployment occurred. The consolidated QA/release gate remains.
