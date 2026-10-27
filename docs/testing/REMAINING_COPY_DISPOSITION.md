# Remaining tracked copy disposition — #142

2026-10-24, source-only follow-through. This classifies entries retained in the
existing `src/i18n/untranslated-copy.json` baseline after bounded UI copy moves.
It is **not** a fresh scanner run, complete source search, translation audit,
rendered result or claim that the app is fully translated. Inline/API/metadata/
helper/provider copy outside that baseline may still need work. No QA/check/
build/browser/API/database/provider/release action ran.

## Retained baseline

| Category | Records | Recorded occurrences | Disposition |
| --- | ---: | ---: | --- |
| Legal pages awaiting operator/content decisions | 75 | 76 | Keep tracked. Resolve #372 operator/content before changing legal wording; a translation is not legal/operator acceptance. |
| Source product names and mapping protocol | 4 | 4 | Keep exact names and machine-readable JSON sample; translate surrounding help, not keys/source identity. |
| Public source/licence attribution and barcode format/sample | 7 | 8 | Keep attribution/licence identifiers, barcode formats and canonical examples literal; do not imply scanner/provider acceptance. |
| Numeric/unit/time/input examples | 12 | 13 | Keep numeric/date/time/unit samples and symbols literal for this slice. Regional formats, parsing and conversion require their own source and rendered evidence. |
| Print CSS | 2 | 2 | Keep CSS literal. It is executable styling text, not a sentence to translate. |

Do not delete these records merely to make the inventory zero or add broad
allowlist/scanner exceptions. Their existence is not evidence of a visible
English sentence or a passing translation/layout check. Preserve existing guard
configuration and all legal/technical text until a scoped action changes it.

## Final ordinary caption in this baseline

The list-detail cover now uses the actual list name as its accessible text,
matching the represented list without an English “list image” suffix. The
image URL, dimensions, layout, household read gate and name remain canonical.
One owned caption record was removed. This is a reversible source copy edit;
no new copy-only test or rendered accessibility result is claimed.

## Still required

- Reconcile untracked inline dictionaries, raw API/transport errors, static route
  metadata, provider content and any new UI against the existing typed-copy guard.
- Keep user names, recipe directions, imported text, IDs, protocol samples,
  licence identities and numeric drafts literal; format display values without
  parsing translated values back into household records.
- Run original EN/ES/pseudolocalized journeys and long-copy/reflow/accessibility
  states later at the required phone/tablet/fridge/desktop sizes. This pass did
  not run the scanner, tests, builds, browser, native or data-boundary fixtures.
- Keep #142 open for original locale-data/timezone/store-claim/layout acceptance;
  this baseline disposition does not replace any criterion. #372 operator/legal
  and native/provider/real-household gates stay separate.
