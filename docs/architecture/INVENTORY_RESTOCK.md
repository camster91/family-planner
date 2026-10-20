# Reviewed inventory replacement restocking — #125

2026-10-20: backend source foundation, **not UI/recovery integrated, not QA
accepted or released**. The full target remains an explicit replacement review
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

- Wire named list/quantity/duplicate review into inventory/history and show
  created vs already-present vs original-removed outcomes with list links/Undo.
- Extend the existing inventory owned journal, canonical recovered review and
  sender to cover this exact request. Unknown outcomes must retain original
  body/key; no separate auto-draining offline queue or legacy write fallback.
- Author EN/ES UI and lifecycle/error recovery. Execute two-household/role,
  duplicate-key/concurrent different-key, failed transaction, deleted target,
  stale source, receipt expiry and checked-row Undo cases during consolidated QA.
  Integration/common paired-context test source is authored, not run.
- No provider/account/physical device operation, schema operation, hosted QA,
  push, merge or deployment occurred. This backend foundation does not close #125.
