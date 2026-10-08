# Pseudolocale QA (#401 / #142)

The existing translation provider can accent and expand message templates by
about 40% of their letters. Visible `⟦…⟧` delimiters identify transformed copy.
Interpolation happens afterward: household names, numbers and other parameter
values remain exactly unchanged. Missing keys remain visible as raw keys.

This is a local/CI review mode, not a supported language. English/Spanish options,
device locale storage, `html lang`, Intl date/number formatting and database/API
values stay unchanged. No translation service or production setting is required.

Both `I18N_PSEUDO_ENABLED=1` and `DESIGN_GALLERY_ENABLED=1` are required. Neither
development nor production builds enable it by default. Never set these QA flags
on a live deployment or promote a QA build. Set both when building and running
the isolated local server so prerendered and dynamic pages agree. Use only the
disposable fixture environment described in `E2E.md`; do not point at live data.

```sh
I18N_PSEUDO_ENABLED=1 DESIGN_GALLERY_ENABLED=1 npm run build
I18N_PSEUDO_ENABLED=1 DESIGN_GALLERY_ENABLED=1 E2E_SKIP_BUILD=1 node e2e/support/serve.mjs
```

In a second shell with the same isolated E2E environment, keep fixture insertion
in UTC (the browser and server use the configured household test timezone):

```sh
TZ=UTC I18N_PSEUDO_ENABLED=1 DESIGN_GALLERY_ENABLED=1 E2E_SKIP_BUILD=1 E2E_REUSE_SERVER=1 npx playwright test e2e/pseudolocale.spec.ts --no-deps --project=phone-390x844 --project=tablet-portrait-800x1280 --project=fridge-landscape-1280x800
```

The dedicated spec is signed out and does not submit forms. It checks expanded
login, registration and recovery controls, labels, target dimensions, focus,
horizontal overflow and serious accessibility findings, and records screenshots.
Run it separately: the ordinary auth setup intentionally uses normal English
labels. With flags off the dedicated spec skips and normal journeys are unchanged.

Unchanged text in this mode identifies copy not yet using the translation layer.
This tool does not prove all core journeys are externalized, pluralization/RTL
readiness, human translation quality, Android text scaling or a new language
release. Those original #142 requirements remain open. Remove both QA flags and
rebuild normally before normal-candidate verification.
