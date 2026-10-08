# Design gallery (#156)

One place to inspect production components and their important states without walking through live household workflows. Parent: #131; related: #139, #152, #155.

## Open it

```bash
npx next dev --webpack -p 3100      # any non-production server
open http://localhost:3100/dev/design-system
```

No sign-in is needed and nothing is read from the database: every component gets props from `src/app/dev/design-system/fixtures.ts`.

## Who can reach it

| Server | `DESIGN_GALLERY_ENABLED` | `/dev/design-system` |
|---|---|---|
| `next dev`, Jest (`NODE_ENV` not `production`) | any | renders |
| production build (`next start`, Docker) | unset or anything but `1` | **404** (`notFound()`) |
| production build | `1` | renders (the E2E server only, `playwright.config.ts`) |

The gate is `src/app/dev/design-system/gate.ts`, read per request (the page is `force-dynamic`), and unit-tested in `__tests__/gate.test.tsx`. **Never set `DESIGN_GALLERY_ENABLED` in a production or review deployment.** The page is also `noindex`. The middleware does not protect `/dev/*` (it is not under `/dashboard`), so there is no login redirect; the gallery has nothing private to protect because it only renders fixtures.

Bundle: Next.js splits code per route, so the gallery's client code is loaded only by `/dev/design-system`. No normal page imports anything under `src/app/dev/`. The route's chunks do exist in a production build (it is listed as `ƒ /dev/design-system`), but they are unreachable while the route answers 404.

## URL options

Everything that changes the page is in the query string, so a URL fully describes a frame and snapshots are deterministic:

| Param | Values | Effect |
|---|---|---|
| `theme` | `light` (default), `dark`, `fridge-night` | Applies the `.dark` token class to the gallery subtree (the viewer's saved theme is never read or changed). `fridge-night` is dark tokens plus the calm display and night dimming frames. |
| `long` | `1` | Pseudolocalises every piece of fixture text (accented, bracketed, about 1.6× longer, short words so it can wrap). Static UI copy inside components is not translated: the app has only `en` messages. |
| `data` | `empty` | Empty fixtures: every data-driven component shows its empty state. |
| `section` | a section id | Renders only that section. |

Example: `/dev/design-system?theme=dark&long=1&section=groceries`.

## Sections

Each section is a `<section id="<id>" data-testid="gallery-section-<id>">`; each specimen has `data-testid="specimen-<name>"` and names its production source file.

| Id | Production components |
|---|---|
| `foundations` | Warm Paper palette and colour tokens, typefaces (Fraunces, Inter), type scale, radii, shadows (`src/app/globals.css`); member colours (`src/lib/member-colors.ts`) |
| `controls` | `.btn-*` buttons (enabled/disabled), board action link, `.input-apple` fields with an error, select, `SearchField`, `RoutineFields`, `RoutineIconPicker`, `CheckboxRow` states |
| `overlays` | `Dialog` and `MoveToSectionDialog` (bottom sheet on phones), opened by a button; `LongPressRow` action sheet; toasts (undo, success, error) in a contained frame plus a live Undo toast |
| `people` | `LargeHeader`, `Avatar` sizes, `ProgressRing`, `Glyph`, `ListRow`/`InsetList`/`SectionHeader` |
| `schedule` | `WeatherTile`, `ScheduleRegion` (now, task, member, imported source), `ComingUpRegion` |
| `meals` | `DinnerRegion`, `RecipeDetail` |
| `groceries` | `GroceriesRegion`; list rows as `ListDetailClient` composes them (`SwipeRow` + `CheckboxRow` + `groceryDetailText`, by store section) |
| `chores` | `ChoresRegion` (open, done, awaiting a check, "N more"), `KidRoutines` (checked, waiting, next, to do) |
| `inventory` | `UseSoonRegion` (expired, use by today, soon, "N more") |
| `states` | `EmptyState` (glyph and illustration), skeletons, `RouteLoading`, `DashboardError` (on demand, it takes focus), `SyncNotice` (offline, stale), `UpdatedLine`, `SyncBanner`, offline sync and conflict row text (`syncStatusText`) |
| `graphics` | Warm Paper illustrations (`src/lib/brand-illustrations.ts`) and loops (`BrandMotion`), then the original chore picture set (`RoutineIcon`, every drawn key). See `docs/product/BRAND.md`. |
| `fridge` | `AmbientCover` calm display and night dimming, only with `theme=fridge-night` (they take focus) |

Overlays that use `position: fixed` (toasts, the calm display) render inside a `ContainedFrame`, whose transform makes it their containing block.

### Not in the gallery, and why

- `TodayBoard` as a whole: it polls `/api/family/board-version`, runs the clock and wake lock. Its regions are shown individually instead.
- `HomeSummary`, `AddToGroceriesButton`, `RecipePicker`, `BoardSettings`, `DevicesManager`, `InventoryClient`, `ListDetailClient` (whole): they load data or call the API on mount or on their main action. Their presentational parts are shown where they exist.
- `RemovedScreen` / `DeviceUnavailable`: they wipe device storage on mount.
- The list page's live offline detail (`data-testid="list-offline-detail"` in `ListDetailClient`, shown under the app-wide offline banner): it reads `navigator.onLine` and cannot be forced; the offline states are shown through `SyncNotice` and `SyncBanner` (and `e2e/sync.spec.ts` covers the real one).
- `ErrorBoundary` default fallback: showing it means throwing during render (noise in the dev overlay); `DashboardError` is the route error state in use.
- `TabBar` and `DashboardNav`: they depend on the signed-in user and feature provider.

## Known findings

`e2e/design-gallery.spec.ts` keeps a `KNOWN_FINDINGS` list for serious axe results in production components that the gallery surfaces (matched by rule and element, so anything else still fails). Remove an entry when the component is fixed. The list is empty: the one finding it started with, the `SearchField` clear button at 20×20 CSS px (WCAG 2.5.8 `target-size`), was fixed by giving the button a 24×24 hit target around the 20px circle.

`LongPressRow` used to have no keyboard route to its menu; it now opens from a "More actions" button shown on keyboard focus, the ContextMenu key, Shift+F10 and right click, as a modal dialog that returns focus on close.

## Tests

- `src/app/dev/design-system/__tests__/gate.test.tsx`: production without the flag → `notFound()`; with the flag → renders; development → renders every section; URL option parsing.
- `src/app/dev/design-system/__tests__/fixtures.test.ts`: fixtures are deterministic and contain no emails, URLs, phone numbers or addresses; members are "<name> Sample"; no gallery file imports Prisma, `pg`, session/auth helpers or a data loader, calls `fetch`, or touches browser storage.
- `e2e/design-gallery.spec.ts` (`docs/testing/E2E.md`): sections, overflow and axe in every theme and long text, empty data, one section, dialog/sheet focus, the error state.

### Visual snapshots

There are no `@visual` baselines for the gallery yet: baselines are recorded from the production build on Linux, and a missing baseline fails the CI visual step. To add them, write `@visual` tests that capture `?section=<id>` (optionally `&theme=…&long=1`) per viewport, then record them on CI: run the **E2E (Playwright)** workflow manually with `update_snapshots: true`, download the `e2e-baselines-<sha>` artifact, review every image and commit it in a PR that says so (`docs/testing/E2E.md`, "Visual baselines"). The gallery needs no masks: its clock and "Updated" times are fixed.

## Add a component

1. Use the production component itself. If it loads its own data, render its presentational child, or add it to "Not in the gallery" with the reason. Do not copy markup into the gallery.
2. Add any data it needs to `fixtures.ts`: fake, deterministic (no `Date.now()`, no random), ids starting `fx-gallery-`, text through `t(...)` so `long=1` covers it, and an empty variant.
3. Add a `<Specimen name source>` to the right section in `sections.tsx` (or a new section in `options.ts` `GALLERY_SECTIONS` plus `DesignGallery.tsx`). Actions are local no-ops or local state.
4. If it mounts overlays with `position: fixed` or moves focus on mount, render it in a `ContainedFrame` or behind a button.
5. Run `npx jest src/app/dev` and the gallery E2E spec; fix or record any new axe finding.
