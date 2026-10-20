# Reviewed inventory replacement restocking — #125

2026-10-20: backend plus UI/recovered-add source candidate, **not QA accepted or
released; adopted journal activation stays off**. The full target remains an explicit replacement review
from active/used/discarded stock and its history, with list/quantity choice,
duplicate-safe provenance, exact request recovery and owned Undo.

## Canonical model and rules

No second grocery/stock model, schema or migration. The effect uses canonical
InventoryItem and List/ListItem through the existing `createListItem` primitive.
Source stays `manual`; immutable `source_key=inventory:<itemId>` distinguishes
the reviewed replacement lot. `source_request_id` points at the creating request
for replay and Undo. Ingredient links must belong to the household. No stock
amount, status, expiry, product recognition or package metadata is mutated.

The user explicitly chooses an existing grocery/shopping list. No default list
is silently created. Desired amount is required, positive and bounded; unit is
explicit or unknown. Remaining stock and label package size do not determine
purchase quantity, and no unit conversion is attempted.

An already-open row on that list with this inventory source key is a no-op.
User/household transaction locks serialize concurrent different-key restocks.
Same normalized text or saved ingredient on other rows is a possible duplicate,
never merged. Review scans at most 2000 open rows, returns at most ten matches
and discloses incomplete comparison. A fresh write refuses until the caller
explicitly allows a separate row if similar rows or incomplete comparison exist.
A checked row no longer blocks a later deliberate replacement.

## APIs and authority

GET `/api/inventory/restock?itemId=&listId=&content=` returns current source name/
version, up to 100 eligible lists, selected-list duplicate review and original
actor/household. Optional read binding is compared/echoed. Unknown/foreign stock
and list IDs are indistinguishable. Stock remaining amounts, dates and product
metadata are not copied into the review or shared list by this endpoint.

POST `/api/inventory/restock` requires a known v1 envelope with original actor/
household/issued-at, reviewed source version, list/content/amount/unit and explicit
similar-row decision, plus Idempotency-Key. It stream-bounds JSON to 8 KiB;
GET/POST share 90 requests/user/minute. Current parent/teen inventory AND lists
authority is renewed under User/household locks before effect and replay. Optional
supplied inventory owner proof is always enforced. All outcomes private/no-store.

The creating ListItem and compact completed receipt commit in one transaction.
Replay proves matching action/hash/actor/household/receipt and current owned list
item existence. Removed list rows are never recreated by confirmation. Old issued
intent cannot become a new operation after idempotency retention. A duplicate
no-op receipt owns no earlier row and cannot undo somebody else's replacement.

POST `/api/inventory/restock/undo` requires original actor/household and request
ID. It renews current authority and reuses the existing O-5 provenance/window
rule: original actor only, ten minutes from original receipt, own still-open rows
only; checked rows are kept and repeated Undo removes zero. Rate 60/user/minute,
4 KiB body. Current inventory/lists features and parent/teen authority still apply.
The existing recipe Undo export is a compatibility wrapper over the shared rule;
its route and accepted semantics are unchanged.

## Remaining implementation and later acceptance

### Inventory/history and saved-request source integration

`InventoryRestockSheet` opens from stock editing and consume/discard history
when inventory write/list capabilities are available. It retains unsaved stock
edit fields behind the sheet. Initial purchase amount is blank; no stock amount
or package-size guess is copied. List selection is explicit, type-labelled and
indistinguishable duplicate names/types cannot be selected until renamed. Target
comparison is a deliberate review; changing item text/list invalidates it.

Modern clients use body-bounded POST `/api/inventory/restock/review` (4 KiB,
shared 90/user/minute read budget) instead of putting private draft names into a
query string. Original read scope is verified before private JSON. The older GET
review remains compatible but the new UI does not use its content query.

Add outcomes keep original key/body on unknown, freeze editable values, and
distinguish created/already-open/removed/no-effect/refused. Explicit quantity/unit
and duplicate permission are shown before sending. List links open a separate
tab so checking the canonical target does not discard an uncertain form.

The existing adopted inventory journal now recognizes `restock`, uses its fixed
POST sender, and requires canonical recovered review of the original list/source/
version/duplicate policy and receipt. Purchase values are displayed separately
from current inventory, and an already-open no-op is not presented as another
created row. Unknown older readers must preserve/quarantine the unfamiliar entry;
do not roll back to a writer that drops it. Public/offline action manifests remain
unchanged, and all adoption/provider/native gates remain unactivated.

Undo reuses original request ID, actor/household and original ten-minute window.
Unknown Undo is retained in the open sheet for explicit same-request retry. A
separate acknowledgement can close without claiming success or cancelling the
server request. It is not persisted as a new offline/durable Undo operation;
after process death, check the canonical list rather than reconstructing an add.
Do not claim this source establishes native lifecycle or restart Undo acceptance.

Client/review/sender/UI source cases cover body/key retention, original target,
scope-before-JSON, ambiguous/similar choices and removed-row recovery. They have
not run. Remaining acceptance:

- Verify named list/quantity/duplicate review, exact journal recovery, unknown
  Undo/manual acknowledgement, nested modals, focus/Back and EN/ES controls.
- Execute two-household/role,
  duplicate-key/concurrent different-key, failed transaction, deleted target,
  stale source, receipt expiry and checked-row Undo cases during consolidated QA.
  Integration/common paired-context test source is authored, not run.
- No provider/account/physical device operation, schema operation, hosted QA,
  push, merge or deployment occurred. This backend foundation does not close #125.
