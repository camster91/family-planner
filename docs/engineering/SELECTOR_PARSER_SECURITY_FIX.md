# Selector-parser security compatibility candidate

PR #355 originally proposed replacing Tailwind 3.4.19 with 4.3.3. That major upgrade fails the existing Tailwind PostCSS setup; do not merge it using historical green checks or weaken rendered assertions to accommodate it.

This candidate retains Tailwind 3.4.19 and pins the build-only transitive `postcss-selector-parser` to 7.1.6 through the existing npm overrides mechanism. Version 7.1.6 fixes [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf): quadratic parsing of flat selectors can exhaust CPU. No production provider, schema, configuration, scheduler or approved artwork changes are included.

This override crosses the consumers' declared major range (`^6`). [Version 7.0.0](https://github.com/postcss/postcss-selector-parser/releases/tag/v7.0.0) changes insertion behavior during iteration. Compatibility must be demonstrated with the application's actual Tailwind/PostCSS compilation, independently inspected rendered differences, and fresh CI on the final head. A successful build alone is insufficient. No baseline adoption is authorized by this document.

## Verification status

Candidate preparation only. Compiled output comparison, independent review, QA and final-head CI are pending. Do not claim security completion or production acceptance from this record.

The earlier full audit of main also reported development-tool advisories unrelated to this parser. The production-only audit reported zero advisories. GitHub's private Dependabot alert endpoint was inaccessible to the integration, so the visible alert count does not prove the complete development dependency tree is clear.

## Release and rollback

Use the existing protected-main/Coolify source-build path after applicable gates pass. Verify `/api/version`, `/api/health`, approved asset delivery and rendered safe journeys for the merged revision. Keep the prior healthy revision and its evidence. Revert this scoped override through the same protected path if compilation or rendering changes unexpectedly; do not substitute a Tailwind major upgrade during rollback.
