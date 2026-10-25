# Preserved finance records to native household views

2026-10-24 source reconciliation for #566; dependencies #104/#134/#499/#128.
Status: bounded delivery design complete for planning review; no slice is
promoted or accepted. This issue plans bounded delivery; it does not turn
archived JSON into active finance features. No schema, backfill, account, bank,
provider or live-data action was performed.

## Current source, not inferred product coverage

| Source | Actual behavior | Limitation |
| --- | --- | --- |
| `prisma/schema.prisma`: Transaction, BudgetCategory | Canonical household income/expense rows and category limits, import metadata | Amount/limit are Float; transactions store DateTime. No household currency setting or typed account/bill/goal relationship |
| `src/app/api/budget/{transactions,categories,stats}` and `src/lib/budget-transaction-write.ts` | Personal parent-only budget feature; current category/transaction APIs and keyed canonical transaction writes | Category/stat/read contracts are not a generalized financial ledger. Stats use UTC month ranges |
| `src/components/budget/BudgetDashboard.tsx` | Monthly summary, category limits, recent transactions, manual transaction forms | Display locale changes number formatting, not denomination: existing denomination is USD |
| `src/lib/imports/budget-app.ts` | Category/transaction/wishlist normalization; integer source cents retained in metadata and converted to current major-unit values | Source archive records are passthrough JSON with required ID, not a validated native domain schema. Unknown currency/relationships are not resolved |
| `src/lib/imports/persist-budget-app.ts` | Default dry run; explicit persist uses ImportJob/ImportedRecord, native category/transaction/wishlist targets and FinancialArchiveRecord | Existing mapping reuses targets on repeated source IDs; no claim of automatic source-update merge or concurrent-import reconciliation |
| `FinancialArchiveRecord` | Household + source app/model/ID unique identity, JSON payload, creation time | Default-off local FIN-0 metadata API/list/sheet source now authored; no accepted CRUD, validated money/date projection, balance calculation or archive promotion UI |
| `src/app/api/admin/imports/[source]/route.ts` | Parent imports through the canonical family/import path | Production import execution remains separate from this plan |
| `src/app/api/users/export/route.ts` | Parents receive household finance archive rows and import-job summaries | Native future entities must be added to portability deliberately; archive inclusion is not native feature coverage |
| `src/lib/account-deletion.ts` | Household deletion inventory includes financialArchiveRecord | Future finance tables/media must enter the same erasure plan; records must not survive household erasure |

Archived source-model keys are exactly `accounts`, `bills`, `billPayments`,
`budgets`, `goals`, `goalContributions`, `incomes`, `screenshotReceipts`,
`spendingPatterns`, `dailyPeriods`, `noSpendEntries`. None proves that its UI or
native model exists. Wishlist is already a native mapping, not another finance
archive screen. `spendingPatterns` stays preserved reference data, not inferred
advice or automatic budget rules.

## Planning acceptance map — #566

This map closes the planning questions in the issue without claiming code,
import or release acceptance. The source inventory above is the authority for
what exists today; the slices below are the only proposed promotion order.

| #566 requirement | Reviewable design location | Explicit boundary / owner |
| --- | --- | --- |
| Inventory preserved models and current APIs | Current source table and the exact eleven archived keys above; FIN-0 | #104 must provide an approved export and identity map. Codex can prepare the report; Cameron decides whether the export is an approved source. |
| Separate native views | FIN-1 through FIN-7 delivery table | Each slice has one bounded entry in Budget and one canonical target. No archive model becomes a screen by name alone. |
| Parent-only visibility | Shared product/data rules; FIN-0 entry and every later slice | Only a fresh authenticated parent person session may read, preview, map, export or promote. Paired devices, teen/child, email-free profiles and shared AI are refused before parsing. |
| Currency and dates | Shared rules and FIN-0 bridge | Explicit ISO currency and integer minor units; date-only values remain `YYYY-MM-DD` with source timestamp/timezone retained. Missing or conflicting semantics stay unresolved. No locale/USD inference or FX. |
| Reconciliation and duplicate safety | Promotion steps 2–4 | Source identity is household + app + model + source ID + mapping version. A frozen hash/body/key is required; a replay reuses the original receipt and cannot create a second target. Counts and per-currency totals report unresolved/unknown separately. |
| Provenance and history | Promotion steps 1–3 and 5 | Raw archive, source snapshot, mapping version/hash, accepted/reused/refused decision and reversal/correction history remain exportable. Imported evidence is not silently rewritten or merged. |
| Export, erasure and departure | Promotion step 6 and current source table | Raw archive plus normalized targets, mapping/provenance, reversals and private receipt bytes are included in parent export and household erasure. A departing parent retains no household finance access. |
| Archive promotion is not automatic | Shared rules, FIN-0 and promotion step 3 | There is no automatic archive-to-ledger conversion, bank sync, OCR, scheduler, advice or background queue. Every promotion requires a parent-reviewed mapping and explicit action. |
| Adaptive UI and rollback | Delivery table, common Budget entry, promotion step 5 | Phone list/detail, tablet/fridge-safe summary, and desktop list/review panel use the existing rounded sheet pattern. Rollback hides new surfaces and stops promotions while preserving additive tables and readable archives. |

The planning artifact is complete when this map, the source inventory and the
bounded slice table are reviewed together. Implementation remains a separate
issue/PR with its own schema, authorization, migration, rendered and release
evidence; no future implementation may mark #566 complete from this document
alone.

**Planning disposition:** after this artifact is read back against #566's five
acceptance bullets, #566 can close as a planning issue. FIN-0 through FIN-7,
source-export identity (#104), platform/API scale (#134) and the all-feature
UI/release work (#499/#128) remain the canonical follow-on work; closing the
planning issue does not close or waive any of those implementation gates.

## Shared product and data rules

- Personal parent sessions only, including reads, previews, exports and direct
  API calls. Refuse paired-device cookies before person auth; exclude teen/child,
  email-free profiles, shared fridge, shared search, assistant context and generic
  household activity. Existing budget feature remains the top-level gate.
- Renew original actor, household, token/session, role and feature authority at
  commit/replay; lock User then household before target/receipt locks. Foreign
  and absent targets share a response, with no sensitive cached proof replay.
- Money uses explicit ISO currency plus integer minor units represented as
  bounded decimal strings at transport boundaries, parsed to checked integers.
  Preserve exact original source integer/value and currency provenance. Never
  choose currency from language, location, account name or a dollar symbol.
  Support only a reviewed denomination/exponent allowlist at each slice. Missing
  source currency requires an explicit parent mapping; no silent USD relabel.
- Before any native money promotion, design an additive minor-unit/currency
  bridge for existing Float rows. Reconcile each row against retained source
  cents where available. Nonfinite, unsafe, extra-precision, signed/transfer,
  conflicting or ambiguous rows remain unpromoted with a reason. Do not silently
  round, rewrite existing balances, or make Float totals a source of truth.
- Date-only plans (bill due day, planned income, goal target, no-spend day and
  daily period) use validated Gregorian `YYYY-MM-DD` / DB Date. Preserve source
  timestamp and source timezone separately. Existing Transaction DateTime and
  UTC stats remain unchanged until an explicit compatibility bridge is accepted.
  A household timezone is an explicit configuration dependency, not a locale
  inference. Unknown source semantics are reviewed, never shifted silently.
- Currency totals stay separated; no FX, rate feed, netting or cross-currency
  arithmetic. Transfers have explicit paired legs and exclusion from spending,
  not an expense/income guess. Imported duplicate flags/fingerprints are evidence,
  not permission to delete or merge native rows automatically.
- Reads are bounded/cursor-based, private/no-store and ownership-bound before
  parsing/rendering. Writes need original body/key, expiry, version checks,
  atomic target+compact receipt and original-owner recovery. Unknown outcomes
  retain the original request; no blind reissue or automatic background finance
  queue. Ledger-like corrections use reversals, preserving accepted history.

## Delivery slices and order

These are proposed surfaces/contracts, not routes or tables already shipped.
Every slice includes EN/ES, empty/loading/error/stale/offline states, keyboard/
Back/focus behavior, parent authority, export/erasure and source-level regression
coverage. All later QA waits for the integrated candidate under the active goal.

| Slice | Entry and adaptive UI | Canonical change / reconciliation | Depends on / done when |
| --- | --- | --- | --- |
| FIN-0 Archive review and money bridge | Budget → Imported data; compact source-model counts, named source/version and per-record review sheet. On phone one list/detail; desktop list + review panel | Read-only bounded typed projections; original raw archive remains exportable privately. Per-record map/review/refusal decision, payload checksum, source version and explicit currency/date mapping. Additive versioned promotion receipt/provenance design; no implicit execution | #104 source export/identity/count reconciliation. Reviewed designs and fixture reports cover every archived source model before FIN-1 writes |
| FIN-1 Manual accounts | Budget → Accounts, balances by currency; Add/edit in short sheets | Proposed FinancialAccount and opening/correction entries, parent-owned household relationships. Archive balance is opening evidence, not additional income. Link existing imported transaction `sourceAccountId` only after parent review and scoped mapping | FIN-0 exact money bridge. Same-source retries do not add opening balance twice; per-currency opening + movements reconcile |
| FIN-2 Bills and payments | Budget → Bills; Due / Paid / All. Bill detail shows payments, not a second transaction list | Proposed Bill schedule + BillPayment linked to an existing canonical transaction or one explicitly created atomically. Partial/late/overpayments and reversal state explicit. No auto-pay or scheduler | FIN-1 if account chosen, FIN-0 otherwise. Source `billId` and payment relationships reviewed; bill payment and spending cannot be counted twice |
| FIN-3 Savings goals and contributions | Budget → Goals; simple target/progress and contribution sheet | Proposed SavingsGoal / GoalContribution with explicit currency and transaction/transfer link. Contributions and reversals do not become expenses unless explicitly typed as such. Preserve `goals` / `goalContributions` source identities | FIN-1 + exact money. Target/progress reconciles from accepted entries; deletion preserves contribution history or refuses with a reason |
| FIN-4 Planned income | Budget → Income; upcoming expected amounts and Received action | Proposed IncomeSchedule + explicit occurrences. Scheduling creates no received transaction. Record received binds one occurrence to one canonical transaction/receipt. Variable pay, skipped occurrence, end date, date-only repeat rules explicit | FIN-0; FIN-1 for account links. Reload/retry cannot duplicate pay; estimated and actual amounts remain separate |
| FIN-5 Receipt references | Transaction → Receipt attachment/review; no generic shared gallery | Proposed private receipt metadata/provenance and validated ownership to existing transaction. Imported `screenshotReceipts` payload is reference evidence, not an automatically trusted downloadable URL/file. Missing originals show unavailable; no silent network fetch | Reviewed private upload/media + erasure/size/type/retention contract. No OCR/provider upload/retention activated by planning. Image path traversal/foreign links fail closed |
| FIN-6 Daily periods and category plans | Budget → Plan; date-range overview with daily drill-down | Proposed Budget/DailyBudgetPeriod, explicit currency and inclusive local-day boundaries. Category rules are reviewed plans, never executable imported text. Planned allowance is separate from actual spending and child rewards | FIN-0 money/date bridge; FIN-1 if balances used. Overlapping ranges, carry-forward/reset rules and DST boundaries reconcile before promotion |
| FIN-7 No-spend views | Budget → Plan → No-spend; calendar/list with manual mark + derived summary clearly separated | Proposed NoSpendEntry date-only annotations. Parent defines qualifying categories/transfers/refunds in reviewed settings. A missing transaction is not proof of a no-spend day. Keep original source mark/provenance | FIN-6; no new child score, streak pressure, reminders or claims that incomplete imports reflect real behavior |

In each slice use the existing Budget entry, tabs/More and rounded form pattern;
do not add eight top-level navigation entries or long setup forms. Advanced
sections remain absent until their slice is accepted. Phone/tablet/desktop use
the same backend; native delivery does not create a separate finance store.
Shared fridge continues to show no detailed finance. Exact mobile frame review
must precede promotion of each new surface under #499/#150/#152.

## Promotion, provenance and rollback design

1. Inventory an explicitly approved source export without mutating it. Validate
   shape, source IDs/relationships, original money/date semantics and coverage.
   Produce per-model input/valid/unresolved/skipped counts and per-currency sums;
   report unknown totals as unknown, not zero. Fabricated fixtures are the only
   inputs used to prepare this plan.
2. Design additive tables/columns/FKs/constraints and old-client behavior before
   any schema execution. Scope every relationship with household ownership;
   unique source mapping includes household, app, source model/ID and mapping
   version. Preserve ImportJob/ImportedRecord accepted mappings. A revised
   archive payload is a conflict requiring explicit review, not a silent update
   of accepted native records.
3. Parent reviews exact mapping/version/hash and unresolved records. A proposed
   promotion command carries that frozen source identity, original actor/family,
   expected archive/native versions, selected currency/date mapping and key.
   Atomic promotion validates authority, creates/links exactly one target and
   receipt/mapping. Link an existing record only after explicit review; never
   match ownership or identity by display name or amount/date alone.
4. Reconcile source count to created/reused/refused counts and original money to
   native per-currency sums. Include null/dangling/duplicate/transfer/negative
   records in the report. Interrupted/unknown requests recover by original key;
   concurrent imports cannot claim the same source twice or overwrite edits.
5. Preserve archive payloads/source snapshots and acceptance history. UI/code
   rollback hides new surfaces, retains additive schema and readable archives,
   and stops new promotions. Do not roll back by dropping tables, mutating
   original archives, deleting accepted finance entries or rerunning an old
   importer against changed data. Any data correction/reversal is its own
   separately reviewed operation with a pre-change backup and reconciliation.
6. Extend parent-only portability with both raw archive and normalized target /
   provenance / reversal mappings. Household erasure covers future tables and
   private receipt bytes; a departing parent cannot retain household finance
   access. Re-read the canonical deletion plan when implementing, including
   shared-created records and another parent's continued ownership.

## Acceptance and external dependencies

#566 is a plan deliverable: the inventory, eight bounded slices, contracts,
adaptive UI and migration/rollback design above satisfy its requested planning
scope in source. They are not code or release evidence for those future slices.
No advanced finance schema or product API is introduced by this document.

Later slice acceptance must include exact currency/date fixtures, source-model
coverage, repeated/concurrent imports, missing/changed provenance, stale actor/
role/household, foreign direct API calls, shared-device refusal, process death /
unknown-write recovery, additive old-client rollback and parent-only export /
erasure. Include phone 390×844, tablet 800×1280/fridge1280×800, desktop1366×768,
EN/ES, large text and read/write errors. Do not claim these passed here.

Codex owns source inventory, bounded designs, implementation and isolated future
verification. Cameron owns visual/product choices when required, source-export
identity/currency/date interpretation, provider/bank/account permissions and
explicit production migration/backfill/rollout decisions. Bank sync, OCR/spend,
billing, new schedulers, production imports and destructive cleanup remain
outside #566. No real finance data was read, copied or changed in this pass.

## FIN-0 metadata browser source — 2026-10-25

A first read-only vertical slice is now authored, unverified and unreleased:
Budget's parent-only Imported data link, `/dashboard/budget/imported` and
GET `/api/budget/archive`. All require the private default-off
`FINANCE_ARCHIVE_REVIEW_ENABLED=1` acknowledgement and existing Budget feature;
no actual environment setting changed. This is partial FIN-0 source, not FIN-0's
money bridge/mapping/checksum/reconciliation completion or source-export approval.

The server page captures the original verified person/account generation and
renews current parent/household/feature before rendering only the private owner
precondition. The API refuses paired devices and non-parents before parsing that
bounded strict header; it compares it to authenticated authority, not to names
or client-selected roles. The shared reader takes original User then household
locks and rechecks current role/family/generation/feature before archive reads.
Responses, including denials, are private/no-store. Neither a page cursor nor
owner header grants authority. No finance data is added to shared/AI surfaces.

The source-model count query returns at most12 groups by construction (eleven
known model keys plus explicit other). Counts are decimal strings; they are
record counts, never monetary totals. The collection selects24 metadata rows
plus one lookahead, ordered created_at DESC/id ASC, with canonical household/
model-bound cursor positions. No raw payload is selected. Source display labels
are clipped in SQL to80/80/160 Unicode codepoints with an explicit shortened-label
notice; source raw originals remain in existing private export. The preservation
created_at label is not a source transaction/due date. SQL scan cost and index/
lock/latency behavior still require real measurement; bounded output is not a
query-plan or complete-household read-performance claim.

English/Spanish uses one list, type/count selector, exact-page retry/newest/older
controls and the existing rounded Dialog for source details. Source identifiers
remain verbatim. Request/body consumption is bounded to15seconds/128KiB; effect
replacement/unmount aborts, stale replies cannot repaint a new owner/filter/page,
and an owner/access refusal masks rows and the open sheet. Filter/cursor recovery
never silently loads another household. No polling, provider, import, mapping,
ledger write, balance/FX, automatic URL/media fetch or promotion is introduced.
The source supplies empty/loading/error/stale/unavailable states and existing
keyboard/focus primitives; no rendered/native Back/scroll/accessibility acceptance
is claimed. Source regressions for scope/cursor/ties, disabled gates, fresh role/
family/generation, metadata projection, original-owner transport, sheet masking
and exact page retry are authored/adapted, UNRUN.

Remaining FIN-0: approved #104 export/identity/count reports for every source
model; explicit source version/checksum and per-record schema/disposition;
validated money/date semantics and mapping/review, existing-Float compatibility
bridge, additive promotion receipt/provenance design; actual layout/frame,
private/shared/old-client, query-plan/isolation/concurrency, export/erasure and
rollback acceptance. FIN-1–FIN-7 and source activation remain separate. No QA,
tests, checks, scanner, browser, build, CI, API/DB request, migration, native,
provider, push, merge or deployment ran.

## FIN-0 current-copy fingerprint and recorded version — 2026-10-25

The same gated read-only API now accepts an exclusive `recordId` query (no model/
cursor/duplicate/extra parameters) for one exact parent-owned archive record.
It renews the same original actor/family/generation/feature under the existing
User -> household lifecycle locks. Missing and foreign-scope IDs share a generic
RECORD_UNAVAILABLE result. No new write, storage, provider, URL fetch, schema,
permission or environment activation is added.

A metadata-first query takes a shared lock on the exact archive row and reads
`octet_length(payload::text)`. Only a1..256KiB representation is transferred to
Node, with the same size predicate in the body query and an exact UTF-8 byte
length check before hashing. No prefix hash is returned. Oversized copies stay
preserved and return too-large; absent/inconsistent/null body metadata returns
unavailable. SHA-256 covers the CURRENT PostgreSQL JSON text representation,
including that serializer's formatting, not original export-file bytes or an
independently approved immutable source snapshot. It is a read-only inspection
aid, not source validation, approval, money/date interpretation, optimistic
version token, portable database-upgrade proof or a promotion receipt. No hash
is persisted into ImportedRecord.checksum or substituted for missing provenance.
SQL serialization/memory/locking/query latency remains unmeasured; the transfer
cap does not bound PostgreSQL work on a large JSON value.

Version metadata requires an exact scoped chain: archive family/app/model/source
ID and canonical ID -> ImportedRecord family/app/model/source ID with target_model
FinancialArchiveRecord and exact target_id -> ImportJob ID in the same family
and source app. Only one matched completed non-dry-run job can contribute its
recorded source_version. The query has a two-row ambiguity lookahead, bounded
80-codepoint version text and a truncation marker. Missing/inconsistent/pending/
dry-run provenance stays unavailable; multiple matches stay ambiguous. Neither
the newest job, matching labels, another household nor a legacy nullable checksum
supplies a guessed version. A completed import is not an approved #104 export.
No starter account, raw job summary/error, source URL or raw payload is returned.

The EN/ES source sheet loads details on demand with15second/32KiB response bounds.
Close, record/page/filter replacement, unmount and original-owner changes abort
or mask obsolete replies; a different record ID cannot supply the selected
record's fingerprint/version. Detail failures retry the same exact record or
refresh the collection. Access changes retire/mask the whole view; a missing
record preserves explicit retry/refresh recovery. Copy distinguishes a stored
fingerprint, recorded version, missing/ambiguous provenance and source approval.
No raw JSON/HTML is rendered or sent to an assistant/provider.

Source cases cover the known empty-object digest, no raw-body response, oversized
payload refusal before body transfer, exact source/target/job household joins,
missing/foreign records, pending/dangling/ambiguous provenance, matched sheet
presentation and wrong-record detail refusal. They are authored/adapted UNRUN;
no QA/tests/checks/scanner/build/browser/CI/API/DB/native/provider/push/merge/deploy
ran. Full FIN-0 still needs immutable original source/version evidence, approved
#104 identity/count reports, per-record schema/disposition and money/date mapping,
Float/minor-unit compatibility and promotion provenance/receipt design, plus
all actual frame/role/isolation/race/query-plan/serialization/rollback/export/
erasure/native acceptance. The private gate remains default-off in source.

## Archive authority row-lock refinement — 2026-10-25

Both collection and exact-record read transactions now share the same authority
helper, with existing User advisory lock then household advisory lock, followed
by `SELECT ... FROM User ... FOR SHARE` and then the exact Family feature row
`FOR SHARE`. The locked User role, household and token generation must still
match the original verified person before family/archive data is read. Missing
or disabled Family refuses before archive counts, rows, payload sizing/hashing
or import-provenance lookup. No new account generation/household is adopted.

The explicit row locks address ordinary SQL role/token/feature UPDATEs that do
not acquire the advisory lifecycle locks. The intended transaction boundary is:
an earlier committed change is observed/refused after the wait; a later UPDATE
waits for the authorized read transaction to end. These are shared read locks,
not role/permission/data writes. Existing User -> household advisory acquisition
order is preserved; no additional participant User lock is acquired afterward.
Five-second transaction limits remain unchanged, and no lock spans a provider
or client-network call. The reader does not lock all archive rows into a global
repeatable-read snapshot. It cannot revoke data already served or prove private
cache clearing on an inactive client.

Source fixtures now provide locked User/Family rows explicitly and preserve the
existing scope/cursor/projection/fingerprint/provenance cases. New authored cases
assert row-lock read order and refusal before archive reads for missing/disabled
households and changed authority. They do not simulate PostgreSQL update waits,
deadlock detection, rollback, timeout release, role/feature churn or actual query
plans. All those acceptance cases remain open. No QA/tests/checks/scanner/build/
browser/CI/API/DB/native/provider/push/merge/deploy ran, and no gate was enabled.
This scoped refinement does not claim a full audit of other budget/SSR readers.

## Proposed exact-value bridge primitives — 2026-10-25

`src/lib/finance-values.ts` now supplies pure, unconnected preparation for FIN-0's
money/date mapping. It changes no schema, existing Float record, importer, API,
settings, currency denomination or native ledger. The proposed first vocabulary
contains USD/CAD with two minor digits; that is a finite source-contract proposal,
not activated household currency support or an approved denomination mapping.
Missing currency holds; locale, symbol, account name or an unrecognized code
never supplies it. Unsupported denominations/exponents need a reviewed extension,
not an assumed two-digit default.

Minor values use canonical bounded decimal integer strings and BigInt arithmetic,
with symmetric magnitude <=9223372036854775807 for a proposed signed-64-bit store.
Safe integer numeric source cents may be represented with a numericInput marker;
unsafe/non-integer/nonfinite numeric input and negative zero hold. Strings retain
integers above JavaScript's safe-number limit exactly. Leading-zero, whitespace,
separator, exponent and decimal-minor spellings refuse instead of being coerced.
Decimal-major input is text only, with exact scale and preserved original
spelling; excess precision and out-of-range values hold without rounding.
No raw BigInt crosses the JSON boundary. A parsed `value` is a unit/currency
primitive, never approved source, authorization, accepted native transaction or
a permission to promote signed/refund/transfer values.

`inspectLegacyBudgetMoney` explicitly requires current legacy denomination USD,
known income/expense direction and explicit non-transfer classification. Existing
USD cannot be relabelled CAD by this bridge. Nonfinite, signed/zero, over-precise,
unsafe-minor or retained-cent conflict values hold. It inspects the shortest
JavaScript decimal spelling of the existing Float without multiplication or
rounding of money. It does NOT reconstruct exact original binary/export bytes.
Where cents are retained, they must match the parsed minor integer exactly;
missing cents yield candidate/sourceMinorMatch unavailable, not a zero value or
reconciled source. Numeric agreement alone proves no original source currency,
export approval, identity mapping, date or whole-record classification. Output is
always a read-only `candidate`, not a promotion-ready result. Raw archive/native
rows and their existing source metadata remain unchanged.

Date-only parsing reuses canonical parseDateOnly and returns the exact input
calendar day. Invalid dates, locale strings, Date objects and timestamps hold
for explicit mapping; there is no timestamp slicing, time-zone inference or
silent day shift. The existing parser's representable-year limitations also
hold rather than normalizing a surprising date. Existing Transaction DateTime,
UTC stats and viewer display behavior are unchanged.

These primitives have no production consumer yet: model-specific source schemas,
explicit reviewed field/currency/date mapping, immutable original source/version,
whole-record disposition, additive target/storage and mutation/receipt/rollback
contracts must be connected before promotion. BigInt/native-WebView support is
part of the future #473 compatibility acceptance; old clients do not receive
these values or a new schema here. Retained source originals, approved #104
exports and complete per-model reconciliation are still required.

Source cases cover exact >2^53 strings and Int64 bounds, decimal spelling/scale,
symbol/locale/exponent/precision/currency holds, retained-cent agreement/conflict,
unknown/transfer/signed Float values and leap/date/timestamp refusal. They are
authored UNRUN. No QA/tests/checks/scanner/build/browser/CI/API/DB/native/provider/
push/merge/deploy ran. This completes only a bounded parser source step; FIN-0,
all-domain native finance and original acceptance remain open.

## Existing Budget import cent-precision guard — 2026-10-25

The existing `src/lib/imports/budget-app.ts` adapter now uses the exact decimal
parser as a precision guard on its established cents /100 -> legacy Float
mapping. This is a first server-side consumer of readFinanceDecimal; it does not
connect archive promotion, currency selection or a new native ledger. Using USD
for the established two-digit target check is not evidence that the original
export declared USD. That original source-currency/mapping decision is still
unresolved under #104/FIN-0; there is no new denomination or FX behavior.

Known numeric cent fields must be safe integers and not negative zero. Transaction
amount and wishlist price must additionally round-trip from the existing Float
major-unit spelling back to the exact original minor integer. For example, a
safe integer source at the JavaScript integer boundary can still lose a cent
when divided into Float major units; the guard refuses that conversion rather
than preserving rounded target data as if it matched. These are schema failures
before plan construction/import-job creation/persistence. The existing route's
validation recovery remains in use; there is no rounding, source coercion,
automatic correction, partial import or fallback to an unchecked writer.

Metadata-only category dailyCap retains a safe integer directly and does not
need a Float-major roundtrip; nullable caps remain valid. Valid ordinary mapped
amounts, retained original cents, signed legacy transaction handling, zero source
values, nonnegative wishlist policy and existing source/target/mapping identities
remain unchanged. Signed imported legacy values are not thereby approved for
new native finance promotion: the separate review candidate still holds signed/
transfer ambiguity. No stored accepted row/history is rewritten or repaired.

Passthrough advanced archive payloads still have no approved monetary schema.
This known-field guard does not recover original bytes or unsafe numeric tokens
already parsed into JavaScript in an untyped archive value, nor does it prove
source/export/identity/currency/date reconciliation. Immutable approved source
and exact per-model mappings remain required before native promotion.

Pure planner regression source covers ordinary/negative/zero retained cents,
unsafe source integers, safe-integer-but-lossy Float conversion, wishlist policy
and large safe metadata-only/null daily caps. It imports no persistence/DB module
and is authored UNRUN. No QA/tests/checks/scanner/build/browser/CI/API/DB/import/
migration/native/provider/push/merge/deploy ran. This guard changes source-input
refusal behavior only; no approved export was supplied or accepted by this pass.
