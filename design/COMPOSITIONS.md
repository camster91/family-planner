# Woven Grove composition review

Prepared 2026-10-08 against merged source `9058d58922ad59d3c02ff60ab2f491d0d584bd3c`, for #150. The approved identity is unchanged: original H, Newsreader/Manrope and the six Woven Grove palette roles. These are original, editable proposals using synthetic review content. They are neither captured production screens nor interactive/runtime acceptance.

## Review sources

The canonical file is [Herewoven — Woven Grove foundations and journeys · review](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4).

| Deliverable                         | Frame                                                                        | Scope                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Source-linked reference annotations | [31:3](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=31-3)     | Seven reference URLs, borrow/avoid notes and original application; unavailable or indirect source observations are labelled. |
| Five mood studies                   | [34:2](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=34-2)     | Main light, fridge night, calendar, food and household/tasks. Brand accents support readable content; statuses use words.    |
| Composition review wrapper          | [53:2](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=53-2)     | Two original landscape layouts, phone adaptation, night privacy and engineering annotations.                                 |
| A: four-region hub                  | [53:8](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=53-8)     | 1280×800; evolves the current landscape TodayBoard hierarchy.                                                                |
| B: schedule-led overview            | [53:56](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=53-56)   | 1280×800; larger schedule above supporting regions.                                                                          |
| A: paired-phone adaptation          | [53:99](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=53-99)   | 390×844; shared-mode overview with a distinct grocery action.                                                                |
| A: night privacy                    | [53:133](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=53-133) | 1280×800; time/date while idle, locked parent controls and explicit opening of shared Today.                                 |
| Study-family state examples         | [54:58](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=54-58)   | Ready, empty, offline and permission copy in tablet/phone typography; not eight complete viewport journeys.                  |

## Direction and rationale

Woven Grove is already the approved visual direction; the alternatives explore hierarchy within it rather than replacing that decision. A is recommended because it evolves the canonical `TodayBoard` regions, keeps food/grocery capture visible, and preserves the current shared-device model. B offers a calmer schedule emphasis but gives food and tasks less independent space. The recommendation does not approve new layouts, night behavior or physical-device performance.

The reference board records principles, not copied screens. No competitor assets, complete-screen rasters, paid generation or imported external UI kits are included. The approved H vector geometry is reused unchanged.

## Engineering disposition

| Area                   | Keep                                                                                                       | Proposed evolution / limit                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical regions      | `src/components/fridge/TodayBoard.tsx`, `regions.tsx`, `styles.ts`                                         | Compare grouping/density before changing the source grid. No new data model or tablet backend.                                                                                                    |
| Typography             | Newsreader brand/date hierarchy; Manrope rows and controls                                                 | Three local `Study /` text styles reflect source tablet/phone region sizes: 24/20 px headings and 20 px tablet rows. They do not replace runtime styles or prove distance readability.            |
| Colour and geometry    | Existing semantic Light/Dark variables; `radius-xl` 24 px; 16/24 px spacing                                | Brand palette accents remain supporting decoration. Labels and member names carry meaning. No new production CSS tokens.                                                                          |
| Shared grocery capture | Existing `DeviceGroceryAdd`, canonical device/list API, name attribution, household opt-in and idempotency | An uncertain operation retries the same key/body. Creation is online-only; no silent queue. The Figma button is a composition example, not a wired API action.                                    |
| Privacy and idle       | Current device restrictions and `src/components/fridge/ambient.tsx`                                        | Shared mode excludes private messages, money, addresses, medical notes and account details. Idle study hides household details. Parent unlocking never grants shared mode access to those fields. |
| Motion and haptics     | Reduced-motion preference and feedback after actual confirmation                                           | No ornamental loop. Haptics require device/user support; no haptic implementation or hardware result is claimed.                                                                                  |
| Graphics               | Exact approved H and brand roles                                                                           | Proposed original woven-line motifs for onboarding, empty, offline, food and status, always with text. Final graphic assets remain under #163.                                                    |

The reusable `Study / Household region` family ([52:54](https://www.figma.com/design/s0qsOr91Au0OJ70SCZEWb4?node-id=52-54)) has two viewport typography/padding variants and four review-state labels. It exposes Title, Body, Status, Action and Show action. Component-property defaults are common; **instances must receive explicit state-specific text**. The state showcase was corrected and its actual rendered text verified, rather than accepting the property labels alone. This family is a design aid, not a production-ready React component or an authorization mechanism.

## Validation observed

- Composition wrapper: 2672×1969; 13 editable region instances, 72 text nodes, 29 frames and 28 vector descendants from four original-symbol copies. No image-filled nodes.
- All 13 composition instances render their requested titles, body text, statuses and visible actions. Actual text was inspected; zero missing values.
- Newsreader/Manrope fonts and shared text styles are applied. Text colours are bound to existing semantic variables. Structural audit found no overflow, missing styles, font mismatch or unbound text colour.
- Full composition screenshot was inspected for hierarchy, readable content, clipping and overlap. No visual defect requiring a layout repair was found.
- The eight-state showcase initially inherited common ready-state copy; explicit empty/offline/permission text was applied, then actual text and the corrected full screenshot were inspected.
- Primary action examples are 56 px high. Empty/offline/permission states use words; private fields are absent from all shared proposals. This is design evidence, not keyboard/axe/runtime or physical-device evidence.

Existing journey annotations cover loading/error branches separately. Complete responsive long-text/state prototypes and production behavior remain part of #151/#139/#133, not inferred from these four composition views.

## Remaining original #150 acceptance

Do not close #150 based on prepared Figma frames alone. Canonical links, original alternatives, mood studies, engineering mapping and explicit privacy/accessibility annotations are now reviewable. The original reading-distance criterion remains unverified.

The reviewer must open A and B at native 1280×800 on the intended mounted tablet, then check the primary date, next event, member and action from both one and two metres. Record device model, physical display size, brightness, distance and observed failures; enlarge/reduce density based on actual results. Also review the phone adaptation at 390×844, night brightness/wake/privacy and whether the chosen composition is accepted. A host screenshot or font size alone cannot supply this evidence.

No store publication, external commissioning, production UI change, provider spend, or client acceptance is implied by this handoff.
