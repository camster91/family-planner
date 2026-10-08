# Hard-coded UI copy tracking (#403 / #142)

The normal unit gate now compares direct production JSX copy against
`src/i18n/untranslated-copy.json`. Each file/text/count record belongs to the
explicit review/migration backlog, not an approved exception or evidence of
translation readiness. The initial inventory contains 1,835 literal-copy
occurrences (1,710 file/text records across 115 files). Some brand/data labels may
intentionally remain literal after review; the scanner does not decide that.
No runtime copy is changed.

The installed TypeScript parser detects direct JSX text and returned literal,
conditional, concatenated and template-fragment text, plus known visible/form/
accessibility attributes (`aria-label`, `aria-description`, `alt`, `title`,
`placeholder`, `label`, `description`, `emptyTitle`, `emptyDescription`,
`confirmLabel`, `cancelLabel`). Whitespace is normalized only for tracking; the
source and rendered copy remain untouched. Duplicate occurrences count separately.

New or changed occurrences fail the gate with source file/line diagnostics.
Removed or translated copy produces a stale record that must be removed.
Duplicate inventory rows and invalid counts fail too. The existing missing-key
and English/Spanish parity checks remain unchanged.

The scanner ignores test files and the explicitly fabricated
`src/app/dev/design-system` gallery (other development routes stay checked),
translation function arguments, role comparison conditions and routing/
style/test attributes. It does not chase indirect constants, helper return values,
data tables, API/server error strings or translation interpolations. Passing this
gate proves only that its detected surface is tracked; those remaining surfaces,
all-string externalization, plurals, RTL and critical human translation review
remain in #142. Do not claim the 1,835 occurrences are translated, approved or waived.

```sh
node scripts/ui-copy.cjs
npm test -- --runInBand src/i18n/__tests__/ui-copy-tracking.test.ts
```

Prefer moving changed/new display copy into the existing translation layer.
If a deliberate source-inventory change is needed during migration, generate it
with `node scripts/ui-copy.cjs --write-inventory`, then inspect the exact diff in
review. Never regenerate blindly to hide a new finding. The generated file carries
file/text/count, not household records or runtime data. Translation acceptance and
the final reviewed-language gate remain separate from copy tracking.

## Language and Theme migration (#405)

The existing preference cards now use ten matching English/Spanish message keys,
including their accessible names and the unchanged language endonyms. This removes
exactly eleven occurrences (ten file/text records) from the initial inventory,
leaving 1,824. Other Settings copy remains tracked debt; this does not establish
whole-app Spanish acceptance. Device values/storage and role guards are unchanged.
`e2e/preferences-locale.spec.ts` checks independent language/theme choices, retained
unsaved profile drafts, focus, 44-pixel targets and reflow in both ordinary locales.
It also supports the separately built opt-in expanded-text mode documented in
`PSEUDOLOCALE.md`; rebuild normally with QA mode off afterward. Expanded phone QA
found an overflowing Spanish Auto label, resolved by wrapping and narrower button
padding without reducing target height. Captures use fabricated local households.
