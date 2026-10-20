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
| Manual item form | New creates use the same intake contract and immutable unknown-save recovery; edit/adjustment semantics retained | Source fixtures updated, not run; legacy POST remains only for older callers |
| Barcode identification | Check-digit/leading-zero normalization, explicit eight-digit format, deliberate local camera and typed fallback, one-item review tray | Source only; permission, lifecycle, accessibility and real camera/native acceptance deferred |
| Public product lookup | Fixed-host bounded Open Food Facts v3 adapter with explicit lookup/apply and attribution; all deployment gates off | Data reuse/attribution approval, coverage, cost/usage and consolidated QA required before activation; no provider calls performed |
| Private product corrections | FoodProduct recognition metadata and immutable stock snapshots, atomic revision-checked opt-in corrections; export/erasure wired | Additive migration/client generation and disposable-DB/isolation acceptance deferred; never a second stock store |
| Package/label/date photo and receipt | Dedicated versioned document suggestions, printed-evidence/date apply, receipt redaction acknowledgement, one-item review and atomic label snapshots | Source only; separate deployment gate stays off pending document-processing/provider acceptance and consolidated QA |
| Stock lifecycle | Versioned atomic changes, reviewed versions/recovery and explicit link/name presence hints are coded; zero stock does not match | Durable offline/native reconciliation and consolidated QA remain; quantity sufficiency/unit conversion are not inferred |
| Refresh/read recovery | Bounded whole-batch reader, DTO/pagination validation, original-person/household response binding and stale-generation suppression; history failure disables stale Undo | Source tests authored, not run; backend-first rollout and consolidated QA required; not a transaction-wide database snapshot |
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

## Barcode and private recognition source — 2026-10-19

The personal parent/teen inventory entry opens a rounded Scan food sheet. Typed
UPC-A/EAN-13/GTIN-14 retain leading zeros and validate modulo-10; eight digits
require explicit EAN-8 or UPC-E intent. Full UPC-E expands before checksum.
Local/variable/restricted codes stay editable with public lookup refused; no
weight, price, quantity or expiry is inferred from a code. Checksum validity is
not proof of GS1 allocation or product-database coverage.

Camera starts only on a deliberate tap, requests video without audio, detects
locally when BarcodeDetector is supported, stops before accepting a code and
stops on hide, close, timeout, track end or unmount. A late permission stream is
stopped. Typed input remains usable when permission or local decoding fails.
No native decoder/plugin, offline queue action or native capability is advertised.

The tray caps at 20 rows and edits one selected item. A repeated code selects its
existing row without adding quantity. Add one package and Separate dated lot are
explicit actions. Label package size stays separate from stock amount/unit;
quantity starts visibly at one package and all package dates start blank. Review
supports storage, dates/date kind, inclusion and removal before canonical intake.
Unknown saves keep the exact serialized body/key and block replacement/navigation;
confirmed rows leave the tray with partial counts. Known PRODUCT_CHANGED refuses
before stock and offers revision refresh while preserving edits.

`FoodProduct` is household-owned recognition metadata, not inventory. Remembering
corrections is opt-in; the existing household lock serializes read/revision/write.
Exact-state retries converge, changed stale metadata refuses before stock, and
product + stock + receipt commit together. Older stock snapshots never change
when a remembered label changes. Export includes the library only for current
parents/teens; household deletion removes it. Personal stock DTOs include bounded
product snapshots; shared Use soon keeps its independent minimal select.

GET `/api/inventory/products` defaults to household recognition only, with fresh
intake authority and private/no-store responses. Explicit public lookup requires
three server gates: enabled, approved data reuse, and valid contact. It sends
only the normalized code to a fixed public host, with six-second/128-KiB bounds,
manual redirects, returned-identity validation and safe image hosts. A database
reservation spaces outbound reads at least 5.1 seconds apart globally and fails
closed; there are no automatic retries or provider writes. Results are suggestions
that need explicit Apply. Missing results never block manual entry. Remote images
load only after deliberate use and carry source/license attribution.

The expand-only migration `database/migration-zzzz-food-products.sql` and Prisma
source are authored, not applied/generated. Barcode/provider/camera lifecycle and
private-recognition integration test source is authored, not run. No provider,
camera, runtime, DB, QA, push, merge or deployment action occurred.

### Official feasibility references (reviewed 2026-10-19)

- [GS1 check digits](https://www.gs1.org/services/how-calculate-check-digit-manually),
  [UPC-E expansion table](https://www.gs1.org/docs/barcodes/GSCN_20-323_Clafiry_Add-on.pdf),
  [GTIN leading-zero representation](https://ref.gs1.org/guidelines/2d-in-retail/1.0.0/).
- [Open Food Facts API introduction](https://openfoodfacts.github.io/openfoodfacts-server/api/):
  current documentation states 15 product reads/minute/IP and a custom app/contact
  User-Agent; deployment must recheck limits and shared-IP traffic.
- [Product v3 read](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-api-v3-product-code/)
  and [barcode normalization](https://openfoodfacts.github.io/openfoodfacts-server/api/ref-barcode-normalization/).
- [Data/image license obligations](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/):
  ODbL database, DbCL content, CC BY-SA images. Attribution is implemented as a
  candidate; no legal clearance or production reuse approval is claimed. Gates
  stay off until Cameron resolves reuse obligations for private corrections.
- [BarcodeDetector](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector)
  and [camera permission](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia):
  secure-context/capability checks and permission fallback do not establish native
  or target-browser support.

Remaining implementation: stock lifecycle reconciliation and offline/native compatibility. Provider eligibility/activation, native hardware acceptance and
consolidated QA remain separate dependencies, not completed issue criteria.

## Manual create recovery source — 2026-10-19

Personal Add item now creates through the same intake endpoint; no fallback to
legacy POST is possible. The sheet freezes its original server context, with a
bounded read only for standalone callers. Unknown outcomes lock fields/Close/Back,
keep the exact body/key across later refusal and show Check same save. A confirmed
save releases ownership before refreshing. A known removed original is explicit
and never recreated by replay. Definite first refusal keeps an editable draft;
a corrected deliberate save may start a new key. EN/ES recovery copy and existing
manual/localization fixtures are updated; tests remain unrun. PATCH, adjustments
and remove keep their existing contracts and still need lifecycle reconciliation.

## Focused food-document capture source — 2026-10-19

The existing personal parent-only photo sheet has separate Fridge, Package/date
and Receipt modes when `INVENTORY_CAPTURE_DOCUMENTS_ENABLED=1` and the existing
scanner is configured. This new gate defaults off; a fridge key alone does not
authorize receipt/document processing. No new provider/key/model, activation or
provider request occurred. Owner acceptance of document-data processing,
eligibility, retention/processor terms and real target-camera quality remains.

Document requests carry `herewoven.food-photo.v1`, the explicit mode and original
person/family; server mode/context validation precedes quota/provider use. The
reply must echo the supported protocol/mode. Older servers' fridge-only replies
are refused as document confirmation, preserving the draft instead of silently
using a different interpretation. Fridge-only requests keep their original shape.
Every route outcome is private/no-store; authority/role/feature are renewed after
the provider read before returning suggestions.

Package capture separates visible label size from stock: model amounts/units are
cleared. Printed date evidence stays transient review text; the editable date
starts blank. Apply requires a valid full date independently supported by the
printed year/date text and an explicitly recognized best-before/use-by prefix.
Missing years, ambiguous numeric order, unsupported wording and production dates
stay manual. The parser supports ISO-style and recognized EN/FR/ES named-month
forms conservatively; this is not a guarantee of OCR correctness. No shelf life,
safety status or current-year assumption is inferred. All photo rows now expose
an explicit best-before/use-by selector instead of labelling every date Use by.

Receipt capture requires a visible acknowledgement to crop/cover personal and
payment details before upload. It has no automatic redaction claim. The prompt
excludes personal identifiers, prices/payment/totals and non-food/refund lines;
model output is still untrusted and needs human review. Receipt dates and suggested
storage are stripped, so transaction time never becomes expiry. Purchased counts
remain editable suggestions, not evidence of remaining household stock.

Document suggestions start unselected and show one item at a time, with Previous/
Next and the total selected save count. Read-only paging remains possible during
unknown-save recovery. Duplicate/unreadable/excess drops are disclosed, never
silently summed into quantity. The reviewed package label is a separate optional
strict intake field saved to the existing InventoryItem package_size snapshot;
no barcode or FoodProduct is fabricated. Label values are frozen with the same
atomic stock/receipt request. No raw document/date evidence is stored in inventory.

Upload parsing is byte-bounded before multipart decoding, with a 20-second read
bound and support for browsers without Content-Length. Upstream JSON is streamed
with a 128-KiB ceiling; existing provider timeout/quota and fixed-host rules remain.
Images stay in the transient review/provider path. Source tests cover extraction,
mode/approval/context refusal, explicit selection/date apply, compact paging and
immutable label intent. Tests are authored, not run. No QA/build/browser/native,
generation/migration, account mutation, push, merge or deployment occurred.

Next implementation: reconcile stock edits/consume/discard/owned Undo and
cross-device/offline/native capability contracts. Document provider acceptance,
actual OCR/permission/device behavior and consolidated QA remain unverified.

## Atomic stock changes and owned Undo source — 2026-10-19

Personal Used it, Throw away, toast Undo and history Undo now use dedicated
`POST /api/inventory/change`, with strict `herewoven.inventory-change.v1`, original
actor/family, issued-at and a required key. No legacy fallback is used. Input is
stream-bounded to 8 KiB and rate-limited to 60/minute/person; all outcomes are
private/no-store and paired sessions are refused. The server-rendered inventory
context is required; standalone callers without it must reopen Inventory.

The transaction takes current user/household authority, receipt and item locks,
checks role/session/feature/ownership, applies the canonical adjustment primitive,
and stores only `{itemId, adjustmentId, kind}` with the same commit. A crash cannot
leave stock/history committed without its confirmation. Existing wrappers share
the same primitives; no second stock ledger or amount algorithm is introduced.
Old endpoints remain for older callers, whose receipt/authority contract is not
retroactively upgraded. Edit/remove paths still need separate reconciliation.

Consume/discard bind the item version the person reviewed. A changed amount/unit,
status or later edit refuses before a new deduction; amounts exceeding stock or
partial use of unknown stock refuse rather than guessing. Whole consume and
discard retain existing lifecycle/history semantics. Partial subtraction retains
small nonzero amounts instead of rounding to six decimals, and personal display
no longer rounds small stock amounts to zero. No unit conversion is inferred.
Undo uses the adjustment's version and returns conflict after later work; repeating
an already undone adjustment does not restore it again.

The recovery sheet owns navigation and other stock changes from submission until
confirmation. A lost/malformed response keeps the exact serialized request/key;
a later access refusal cannot replace it. The backend's explicit no-effect
conflict/amount/missing-target outcomes can release it for fresh review because
those checks run inside the serialized atomic receipt boundary. An expired or
authorization-refused unknown intent stays owned; it is not declared unapplied.
Known removal of the original history/stock is explicit and never recreated.

Replay renews current authority and owned existence. Compact historical receipts
never return cached quantities as current truth; confirmation refreshes the live
list/history. Undo buttons are still checked against current adjustment/item state
when invoked. No native/offline capability is advertised and pending state is
memory-only; process-death/restart/durable-queue acceptance remains open.

Client/contract/disposable-DB and UI recovery test source covers duplicate recovery,
atomic rollback, stale versions, Undo after later edit, foreign targets, role/token/
expiry refusal, mismatched receipt and same-key recovery through later refusal.
Existing inventory/localization fixtures are updated. All are authored, not run.
No QA/build/browser/native run, generation/migration, provider/account action,
push, merge or deployment occurred. Next: edit/remove recovery, matching/unit
confidence and offline/native reconciliation before consolidated acceptance.

## Reviewed edit and removal source — 2026-10-19

Personal Save edits and the existing explicit Remove/history confirmation now use
inventory-change.v1 too. Both bind the original person/household and the version
opened in the editor. An intervening consume, storage/unit change, edit or remove
refuses before replacing newer work; the client does not rebase automatically.
The unknown-operation sheet owns the original body/key through response loss and
later access refusal. A collapsed Reviewed changes panel shows the actual edit
fields, including explicit cleared values, rather than implementation JSON.
Remove retains its history-loss warning and has no invented deletion Undo.

Shared `inventory-edit.ts` transaction primitives contain the canonical edit and
remove logic. Renames re-resolve only same-household Ingredient links; an explicit
foreign/missing ingredient is refused identically. Stock label/product snapshots
and remembered FoodProduct metadata are not rewritten by a normal name edit.
Dates/storage/category/amount fields use existing validation and monotonic versions.
Legacy PATCH/DELETE use these same primitives while retaining their older request/
response contracts. Their old client-context/replay guarantees are not advertised
as upgraded. Legacy delete now refuses a lost completion-row update instead of
committing an unconfirmed deletion.

New edit/remove commit with compact `{itemId, kind}` receipts; they do not invent
consume history. All change confirmation now also checks a completed actor/family/
action/request-hash receipt whose body matches the returned pointer. Edit replay
checks current owned existence and never restores stale fields. Removal replay
uses the atomic receipt as historical deletion proof after the item/history are
gone. Missing/pruned/mismatched proof stays unconfirmed; it never repeats deletion
or recreates stock. Current stock still comes from the refreshed list, not cached
receipt state. Original consume/discard/Undo pointer shapes remain readable.

Source tests cover stale overwrite/removal refusal, exact edit/removal recovery,
commit rollback, foreign ingredient refusal, post-deletion proof, missing/forged
proof and matching client receipts. Existing editor/localization fixtures follow
the versioned endpoint. EN/ES review labels and focus restoration are wired.
Tests are authored, not executed. No QA/build/browser/native, generation/migration,
provider/account action, push, merge or deployment occurred. Next: ingredient/unit
matching confidence and refresh/offline/native compatibility reconciliation.

## Honest ingredient-presence matching source — 2026-10-19

Cooking suggestions retain ADR-0007's canonical presence-only rule: exact saved
Ingredient link first, normalized-name fallback for unlinked stock, no semantic
AI substitution, cross-unit conversion or enough-for-recipe inference. Matches
now carry `linked`/`name` provenance. Known zero/non-finite/non-positive quantities
and finished stock are excluded by the index; SQL excludes zero stock before
cooking/use-soon caps. Unknown amounts can still identify a food, with an explicit
amount/unit check. Existing expiry rules remain unchanged.

Cook replies add `matching: presence_only` and comparison-incomplete metadata.
Owned recipes containing foreign ingredient links are skipped whole, never
partially compared or returned with foreign names. Malformed/oversized suggestion
metadata is skipped with incomplete disclosure. The personal HTTP reader validates
bounded counts, IDs, coverage, disjoint ingredient sets and known match modes;
old replies remain readable with match-details-unavailable copy. New or contradictory
sufficiency modes refuse instead of presenting unsupported claims.

Inventory shows Found/matched wording plus a calm amount/unit/condition reminder
and collapsed match details. All-matched recipes still offer the existing canonical
grocery review, because presence does not prove enough stock. Unmatched-only adds
keep their explicit reviewed selection; no stock decrement or inferred shortage is
written. Grocery review receives optional link/name provenance and translated hints;
legacy replies still work. Every add still needs the existing ingredient/list review.

Today's personal dinner count uses the same zero-stock/matching rule and says
not found in inventory rather than declaring real-world absence. Inconsistent
ingredient ownership suppresses the count. Shared-device DTOs still omit this
count, and no stock quantities, ingredient names or match arrays are added to
shared surfaces. The shared Use soon select remains its original minimal fields.

Focused contract/pure/isolation/UI and existing fixture sources are updated,
not executed. No QA/typecheck/lint/build/browser/native, schema/provider/account,
push, merge or deployment action occurred. This is matching transparency, not
calibrated AI/OCR accuracy, quantity sufficiency or native acceptance. Next:
bounded refresh and durable offline/native capability reconciliation.
