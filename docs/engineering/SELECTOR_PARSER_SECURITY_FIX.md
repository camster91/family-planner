# Selector-parser security compatibility candidate

PR #355 originally proposed replacing Tailwind 3.4.19 with 4.3.3. That major upgrade fails the existing Tailwind PostCSS setup; do not merge it using historical green checks or weaken rendered assertions to accommodate it.

This candidate retains Tailwind 3.4.19 and pins the build-only transitive `postcss-selector-parser` to 7.1.6 through the existing npm overrides mechanism. Version 7.1.6 fixes [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf): quadratic parsing of flat selectors can exhaust CPU. No production provider, schema, configuration, scheduler or approved artwork changes are included.

This override crosses the consumers' declared major range (`^6`). [Version 7.0.0](https://github.com/postcss/postcss-selector-parser/releases/tag/v7.0.0) changes insertion behavior during iteration. Compatibility must be demonstrated with the application's actual Tailwind/PostCSS compilation, independently inspected rendered differences, and fresh CI on the final head. A successful build alone is insufficient. No baseline adoption is authorized by this document.

## Verification status

On 2026-10-07 the compatibility review compiled the application's actual
`src/app/globals.css`, complete Tailwind content/config and PostCSS/Autoprefixer
pipeline twice: first with installed selector-parser 6.1.4, then with exact
7.1.6 substituted for all selector-parser imports. Tailwind stayed 3.4.19.
Both compiled stylesheets were byte-identical:

| Compiler | Output bytes | SHA-256 |
| --- | ---: | --- |
| selector-parser 6.1.4 | 106004 | `b6c940d4836d538f538b99cf17fe4eb409eee14e87d858dfab6ecff1487a2c2f` |
| selector-parser 7.1.6 | 106004 | `b6c940d4836d538f538b99cf17fe4eb409eee14e87d858dfab6ecff1487a2c2f` |

This demonstrates no generated-CSS change for the current application; it
is not a general compatibility claim about every parser consumer. The code
candidate `4e53831b6544af57f4f2e6ac2b5569c193f44454` also has successful hosted
Build & Test, imported-image and E2E checks. This documentation update requires
fresh final-head checks before merge. No visual baselines were changed.

GitHub's authenticated Dependabot endpoint was readable during this review.
It reported this selector-parser advisory and a separate moderate
`sprintf-js` precision/CPU advisory in development tooling. That second alert
has no patched version reported and remains unresolved; the override must not
be described as clearing all repository advisories. No production remediation
or acceptance is claimed before merge and runtime verification.

## Release and rollback

Use the existing protected-main/Coolify source-build path after applicable gates pass. Verify `/api/version`, `/api/health`, approved asset delivery and rendered safe journeys for the merged revision. Keep the prior healthy revision and its evidence. Revert this scoped override through the same protected path if compilation or rendering changes unexpectedly; do not substitute a Tailwind major upgrade during rollback.
