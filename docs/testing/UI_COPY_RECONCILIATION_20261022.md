# UI copy inventory reconciliation — 2026-10-22

This is a reviewed source-inventory update under #403/#142, following
`docs/testing/UI_COPY_TRACKING.md`. It is not an exception list, language acceptance,
or evidence that all app strings have been externalized. The scanner/test scope
and failure rules are unchanged. Existing broader translation debt stays in #142.

## Review performed before generation

At35aa6c28 the stale inventory had517 file/text/count records. The current scanner
found638. The exact differences were283 new/changed records across26 files and
161 records no longer directly rendered. Source values and surrounding conditions
were inspected before using the documented `--write-inventory` command.

Of the283 new/changed records,269 are members of explicit English/Spanish display
branches.267 use the component's `es` value (derived from the active locale);
two bulk-prep links use `locale.startsWith("es")` directly. They remain tracked
because inline bilingual copy is still translation-maintenance debt, not because
its current English/Spanish branches are missing. Source review covered private
context checks, unknown-result recovery, recipe/prep reuse, portion allocation,
grocery review/outcomes/Undo, record pickers, timing buffers and routine provenance.
No branch chooses an actor, permission, request body, provider or canonical record.

The remaining14 original records were separately reviewed:

- One real untranslated device status (`Removed`) bypassed the existing typed
  device catalog. It now uses `text("removed")`, including Spanish `Eliminado`.
  A mounted EN→ES regression verifies the same badge, unchanged device label and
  exactly one read with no device action. This record is removed from the debt
  inventory rather than accepted as untranslated.
- Two format examples: `YYYY-MM-DD` and `YYYY-MM-DDThh:mm`. These describe the
  explicit accepted date/time formats; their spelling is preserved.
- Five attribution/identifier records: Open Food Facts ODbL and CC BY-SA labels
  (in inventory and barcode views), EAN-8 and UPC-E. Source/license identifiers
  are preserved rather than translated or presented as household data.
- Six quantity/unit/display records: `ms`, `+1`, `500 g / 6 × 200 ml`, `min`,
  `min /`, and `Original ·` (the same word in English and Spanish). Numeric
  values and their meaning are unchanged. The inventory retains these literals
  for future copy-system work; this review does not exempt them from tracking.

The161 stale records belong to nine source files:

| Source area | Removed records | Current source |
| --- | ---: | --- |
| Family invite |26|Typed profile-setup/invite copy |
| Household settings |14|Typed family-settings copy |
| Help |50|Typed help copy and native disclosures |
| List detail |17|Existing localized list controls/recovery |
| Notifications |31|Typed supporting UI copy |
| Search |14|Typed supporting UI copy |
| Dashboard form sheets |2|Scoped chore/list catalogs |
| Add to groceries |6|Bulk/grocery review copy |
| Recipe detail |1|Changed source attribution wording with EN/ES branches |

Stale entries are removed because the scanned source no longer contains those
exact direct literals/counts. Removing a record is not a claim that every indirect
string in that file is translated. No routes or production files are excluded.

## Expected reconciled inventory

After fixing the status badge:637 records, down from the pre-fix source638.
Relative to the old517:161 stale rows removed,281 new rows added and one existing
record's count updated. The269 bilingual and13 reviewed literal new/changed
records total282. Remaining unchanged old records are preserved. The source-only
review snapshots contain no household/runtime data:

- `/tmp/herewoven-web-qa-copy-inventory-review-20261022.json`
- `/tmp/herewoven-web-qa-copy-pair-audit-20261022.json`

## Verification boundary

The copy scanner, missing-key/parity tests, types/lint and full suite are still
run after this update. This document does not predeclare their outcome.
Rendered locale, expanded-text, accessibility, provider, native/store and human
translation acceptance remain separate gates; private records/names/URLs/keys
are never translated by this inventory operation.

Observed after reconciliation: `node scripts/ui-copy.cjs` exits0 and tracks652
occurrences in637 file/text/count records. The exact delta is281 added rows,
161 removed rows, and one existing `Try again` occurrence count increasing to2
in the meal form. Four focused suites pass21 tests (2.548s), including unchanged
copy-scanner coverage, global/scoped translation-key parity, display-locale cases
and the mounted device-badge regression. Types/lint exit0 (44 existing warnings).
Logs:`/tmp/herewoven-web-qa-copy-final-20261022.log`,
`/tmp/herewoven-web-qa-types-copy-20261022.log`,
`/tmp/herewoven-web-qa-lint-copy-20261022.log`.
Full-suite and rendered-language results remain unproven at this checkpoint.
