# Preserved finance records to native household views

2026-10-20 source reconciliation for #566; dependencies #104/#134/#499/#128.
Status: delivery design authored, not promoted or accepted. This issue plans
bounded delivery; it does not turn archived JSON into active finance features.
No schema, backfill, account, bank, provider or live-data action was performed.

## Current source, not inferred product coverage

| Source | Actual behavior | Limitation |
| --- | --- | --- |
| `prisma/schema.prisma`: Transaction, BudgetCategory | Canonical household income/expense rows and category limits, import metadata | Amount/limit are Float; transactions store DateTime. No household currency setting or typed account/bill/goal relationship |
| `src/app/api/budget/{transactions,categories,stats}` and `src/lib/budget-transaction-write.ts` | Personal parent-only budget feature; current category/transaction APIs and keyed canonical transaction writes | Category/stat/read contracts are not a generalized financial ledger. Stats use UTC month ranges |
| `src/components/budget/BudgetDashboard.tsx` | Monthly summary, category limits, recent transactions, manual transaction forms | Display locale changes number formatting, not denomination: existing denomination is USD |
| `src/lib/imports/budget-app.ts` | Category/transaction/wishlist normalization; integer source cents retained in metadata and converted to current major-unit values | Source archive records are passthrough JSON with required ID, not a validated native domain schema. Unknown currency/relationships are not resolved |
| `src/lib/imports/persist-budget-app.ts` | Default dry run; explicit persist uses ImportJob/ImportedRecord, native category/transaction/wishlist targets and FinancialArchiveRecord | Existing mapping reuses targets on repeated source IDs; no claim of automatic source-update merge or concurrent-import reconciliation |
| `FinancialArchiveRecord` | Household + source app/model/ID unique identity, JSON payload, creation time | No product CRUD, validated amounts/currency/date projection, balance calculation or archive promotion UI |
| `src/app/api/admin/imports/[source]/route.ts` | Parent imports through the canonical family/import path | Production import execution remains separate from this plan |
| `src/app/api/users/export/route.ts` | Parents receive household finance archive rows and import-job summaries | Native future entities must be added to portability deliberately; archive inclusion is not native feature coverage |
| `src/lib/account-deletion.ts` | Household deletion inventory includes financialArchiveRecord | Future finance tables/media must enter the same erasure plan; records must not survive household erasure |

Archived source-model keys are exactly `accounts`, `bills`, `billPayments`,
`budgets`, `goals`, `goalContributions`, `incomes`, `screenshotReceipts`,
`spendingPatterns`, `dailyPeriods`, `noSpendEntries`. None proves that its UI or
native model exists. Wishlist is already a native mapping, not another finance
archive screen. `spendingPatterns` stays preserved reference data, not inferred
advice or automatic budget rules.

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
