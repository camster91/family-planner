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
| Barcode identification | Check-digit/leading-zero normalization, explicit eight-digit format, deliberate local camera and typed fallback, one-item review tray | Source only; permission, lifecycle, accessibility and real camera/native acceptance deferred |
| Public product lookup | Fixed-host bounded Open Food Facts v3 adapter with explicit lookup/apply and attribution; all deployment gates off | Data reuse/attribution approval, coverage, cost/usage and consolidated QA required before activation; no provider calls performed |
| Private product corrections | FoodProduct recognition metadata and immutable stock snapshots, atomic revision-checked opt-in corrections; export/erasure wired | Additive migration/client generation and disposable-DB/isolation acceptance deferred; never a second stock store |
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

Remaining implementation: migrate manual creates to intake; focused package/date
photo and receipt review; stock lifecycle reconciliation and offline/native
compatibility. Provider eligibility/activation, native hardware acceptance and
consolidated QA remain separate dependencies, not completed issue criteria.
