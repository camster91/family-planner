# Herewoven — approved Woven Grove visual system

Herewoven remains the product name: **Everyday life, held together.** / **A shared place for the everyday work of home.** Woven Grove is the approved visual direction, not a technical identity or name migration. `src/lib/brand.ts` is the display-copy contract; `DESIGN.md` is the design contract.

## Approved palette (all six retained)

| Name | Exact hex | Role |
|---|---|---|
| Chalk | `#F7F4EC` | Page and logo backing |
| Forest Ink | `#182D2A` | Primary text; dark elevated surfaces |
| Evergreen | `#245B50` | Light primary actions, links, success |
| Clay Coral | `#D76C50` | Accent artwork/decorative marks, not ordinary text on Chalk |
| Soft Iris | `#C7B8E6` | Supporting artwork and quiet decorative treatments |
| Pollen | `#E6BD55` | Supporting artwork, warning fill with Forest Ink text |

All six have first-class `--brand-*` tokens. Existing brand aliases and semantic tokens remain compatible across parent Today, kid/teen, shared-device board, calendar, meals and routines. Status and member/module colors have distinct contrast-safe shades: they do not redefine or remove the approved six swatches. Do not put Coral/Iris/Pollen behind white ordinary text or use them as body text on Chalk.

Light actions use Evergreen, with darker hover `#1D4A41` and press `#163C34`. Dark grouped/elevated surfaces are `#11211E` / Forest Ink. Dark actions use lifted Evergreen `#397D6E`, hover `#347365`, press `#2E685B`; labels and links use Chalk/green-grey shades. Plain actions use a tinted pressed background, not faded text. Destructive actions retain separate red text/fill shades; warning/success labels remain text-safe.

`src/__tests__/brand-contrast.test.ts` measures the actual source token values, including tint compositing, normal/hover/pressed filled controls, focus rings, inputs and status colors in both themes, at 4.5:1 text / 3:1 non-text. Thresholds and pair coverage were not reduced. This is source-token evidence, **not** computed browser-paint or whole-app accessibility certification. Browser QA must check actual light/dark paints, pressed states, reflow and focus.

## Exact artwork and provenance

Selected source: `HerewovenBrandKit/WovenGrove-Selected/asset-kit`. Adopted copies are under `public/brand/woven-grove/`. The approved transparent symbol is **unchanged**:

- File SHA-256: `6c920161ae35cb038b2132aa28f709359102a41d347bbfd1c34c5d88cc0e6e00`.
- Approved geometry fingerprint from source QA: `cadefe6bc85d3c80c8d017e61c52441294fdc83c4f77aa9594058db2b040db3e` (different from the file hash, not a discrepancy).
- `BrandMark` uses `logos/herewoven-symbol.svg`, backed by Chalk in both themes. No tracing, recoloring, filtering, reverse variant or generated replacement.
- Horizontal/stacked/wordmark SVGs and PNGs, and the original symbol, are preserved for approved exports. Runtime wordmark text uses Newsreader 600 beside the exact mark.
- `public/favicon.svg` is the approved 48px paper tile; ICO and 32/48 PNGs are exact copies. Apple 180px and PWA 192/512px icons are rasterizations of the approved 128px paper-tile SVG using Sharp, with unchanged paths/colors. URLs and declared dimensions stay truthful; no maskable/adaptive variant is claimed.
- `public/brand/woven-grove/adoption-manifest.json` records copied/rasterized asset and font hashes.

The exact woven graphic appears in the landing hero, shared auth frame and household setup card. It is static, reserved at its intrinsic 2560×1664 ratio and uses the existing decorative `BrandIllustration` contract (empty alt, aria-hidden, lazy/default, eager hero, reduced-motion fade behavior). Operational views are not wallpapered with an abstract banner.

### Bounded retained legacy art

Task-specific Warm Paper calendar, meal, grocery, chore, reward, notification, invite/help and completion illustrations remain secondary functional art. Existing task-specific loops retain reduced-motion/data-saver/offscreen behavior. They are not the official primary logo or typography. Legacy kitchen/auth/house-divider artwork is no longer used on landing/auth; obsolete files remain for compatibility rather than being deleted. Recovery's cached houses illustration and transactional email banner remain secondary functional assets; no new provider generation is authorized. Do not automatically replace every task spot with the same abstract graphic.

The old `/og-image.jpg` contains a baked-in legacy name and remains excluded from social metadata. No new social-image approval is invented.

## Typography

- Newsreader: display/section headings and wordmark, weight 600; automatic optical sizing.
- Manrope: body 400, actual variable UI weights 500/600/700.
- Both normal variable TTF sources and SIL OFL licenses are vendored in `src/app/fonts/`, loaded by `next/font/local`; no Google download at build or runtime.
- Operational sizes, line heights, responsive structure and target-size contracts are retained. No serif is forced into dense task rows or form labels.
- Static offline recovery uses system fallback fonts so it remains self-contained without enlarging the service-worker cache or caching private data.

## Metadata, compatibility and release limits

Browser/PWA and recovery theme colors follow Woven Grove. The offline cache version is bumped to `v2` so changed recovery/favicon bytes refresh, but the `fp-offline-` prefix, three public precache URLs and network-first routing/privacy behavior remain unchanged.

No routes, origin, Android applicationId (`com.ashbi.familyplanner`), cookies, storage keys, schema, APIs, role/device privacy checks, canonical data flows, feature flags, idempotency or Undo contracts are migrated. Native icons/store releases are outside this web display scope.

The unrelated canonical brandbook exporter refuses six primary colors; no palette was dropped/reclassified and no fake PPTX/PDF was supplied. That export limitation does not block this web source adoption.

Local RAM is constrained. Focused RED→GREEN source/SSR/token checks are recorded in `docs/testing/WOVEN_GROVE_ADOPTION.md`; full build, live/browser paint and final release validation are parent/CI-owned. No visual baselines, masks, tolerances or contrast thresholds were weakened.
