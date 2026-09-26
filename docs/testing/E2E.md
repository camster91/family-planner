# Browser E2E, visual snapshots and accessibility smoke (#155)

Playwright drives the production build of the app in Chromium against the synthetic fixture households from #154 (`TEST_DATA.md`). It complements the Jest API/isolation tests; it does not replace them.

## What runs

| Spec | What it checks |
|---|---|
| `e2e/auth.setup.ts` | Signs in Family A parent, Family A child and Family B parent once via `POST /api/auth/login` and saves browser state to `e2e/.auth/` (gitignored). |
| `e2e/journeys.spec.ts` | Signed-out redirect with return path; wrong password; offline and slow sign-in; parent UI login lands on a dashboard with real fixture rows; chores, calendar and budget pages; child kid-home with its own missions only; child redirected from `/dashboard/budget`, `/locations`, `/settings`, `/chores`, `/family`; child nav hides links it would be redirected from and shows Lists and Emergency; child gets 403 from budget APIs; child opens Lists and a list with no create/delete controls and gets 403 creating a list (D9, #102); child gets `allowed: false` from `GET /api/capture` and 403 "Ask a parent to add this." from `POST /api/capture` (D4); with handoff and allowance temporarily enabled by the parent, the child's handoff page shows only the sitter name and times (no code words, phone, pickups or house notes) and the allowance page is reachable, read-only and own-rows only (D2, D5); a Family A list shows its items; the parent dashboard Shopping card shows Family A's oldest 5 open grocery items (quantity rendered as "× n", long text included, checked items excluded) with a "1 more to buy" row linking to `/dashboard/lists`, and an item row opens `/dashboard/lists/fx_list_a_grocery`; Family B's card shows only its own single open item with no overflow row; Family A never sees Family B titles on shared pages, in collection APIs, or via a Family B list id in the URL (and the reverse for Family B); sign out (as the Family A teen, so the shared stored sessions survive the `token_version` bump) revokes the old cookie. |
| `e2e/a11y.spec.ts` | axe-core (WCAG 2.0/2.1/2.2 A+AA tags) on login, parent dashboard (light and dark), chores, calendar, kid home and kid Lists. Fails on `serious`/`critical`; see the allowlist below. |
| `e2e/fridge.spec.ts` | Today board `/dashboard/today` (#119/#159). Inserts a few labelled Family A rows (`fx_e2e_fridge_*`: tonight's and tomorrow's dinner, a subscribed calendar and one imported event) plus parent-only canaries (budget transaction, medication note, address, private message) before the tests and deletes them afterwards. Checks every region with fixture data (events still to come in the viewer's zone, imported event labelled "From Riverside School District", dinner and cook, 5 open groceries with "1 more to buy", chores due today per person, next 3 days); no canary, event location/description or meal note appears in the rendered HTML or RSC payload, and no XP/streak/budget words on the board; fridge mode hides the nav, every board target is at least 44×44 and nothing overflows horizontally; the user menu links to it; client refresh fires after 5 minutes and the offline notice appears; child role sees the board without calendar/chores/meals/features links; the empty household shows each region's empty state; axe (serious/critical) on the board, fridge mode, child and empty views. `@visual fridge view baseline` runs only in `fridge-landscape-1280x800` and `tablet-portrait-800x1280`. |
| `e2e/device.spec.ts` | Shared tablet (#241, `docs/architecture/SHARED_DEVICE.md`). The default page is the tablet; a second context is the Family A parent. Resets every device, pairing, PIN, audit and `device-*` rate-limit row before each test and inserts parent-only canaries (`fx_e2e_device_*`: budget transaction, private message, medication) for the file. Covers: the parent pairs through Settings → Devices ("Pair a tablet": name → code with expiry countdown → the tablet types the code lower-case with a space, normalised → the dialog switches to "Type the number shown on the tablet" → confirm) and the tablet lands on `/device/today` with Family A's board, no `/dashboard` links, device cookies and no `session_token`; the `/device/today` HTML, its RSC payload, `GET /api/device/today` and `GET /api/device/me` contain no fixture email, event location, canary or `email`/`age`/`avatar_url`/`xp`/`level`/`streak`/`family_id` key; a device alone is sent from `/dashboard/*` and `/login` to `/device/today`; the device list shows Active / "Active now" and "Paired by" activity. Tablet PIN set in Settings (a common PIN is refused), a wrong PIN is refused, parent mode banner, no `fpd1_` value in storage, "Done", `visibilitychange` hidden and reload each return to shared mode, and an elevated-only call then gets `403 ELEVATION_REQUIRED`; rename and "Remove this tablet" under parent mode (purge → `/device/removed`). Removal from settings with reason "Lost": the board's own 5-minute refresh gets `DEVICE_REVOKED`, `fp-device:v1:*` local/session storage is purged (other keys kept), device cookies are gone, Back does not show the board and `/device/today` goes to `/device/pair`. Replace at the 5-tablet limit (four spec-owned rows `fx_e2e_device_spare_*` plus a paired tablet): a plain code is refused, "Replace" with the box ticked succeeds, the dialog reports "Kitchen tablet was removed." from the server, the list shows the new tablet active and the old one removed "(replaced)", and the old tablet is purged on its next refresh. Invalid code and "This isn't my tablet" (tablet shows "Pairing was cancelled"). Child and teen are redirected from `/dashboard/settings/devices` and get 403 from `/api/family/devices` and `/api/users/elevation-pin`. axe (serious/critical) on `/device/pair`, `/device/removed`, parent mode on `/device/today`, the Tablet PIN row and dialog (scoped: the rest of Settings has older findings, see Known gaps), `/dashboard/settings/devices` and the pair dialog. `@visual shared tablet baselines` (pair, removed, elevated banner, device list) run only in `fridge-landscape-1280x800` and `tablet-portrait-800x1280`. |
| `e2e/visual.spec.ts` (`@visual`) | Screenshots of the login page and the parent dashboard in light and dark. |

Every spec runs in each viewport project (AGENTS.md "Responsive QA baseline"):

| Project | Viewport | Touch | Mobile |
|---|---|---|---|
| `phone-390x844` | 390×844 | yes | yes |
| `phone-430x932` | 430×932 | yes | yes |
| `tablet-portrait-800x1280` | 800×1280 | yes | no |
| `fridge-landscape-1280x800` | 1280×800 | yes | no |
| `tablet-large-1920x1200` | 1920×1200 | yes | no |
| `desktop-1366x768` | 1366×768 | no | no |

All projects use device scale factor 1, locale `en-US`, zone `America/Toronto`, light colour scheme, and `prefers-reduced-motion: reduce`.

## Run it locally

Prerequisites: Node 22 (`.nvmrc`), a local PostgreSQL, and Chromium for Playwright 1.56.1 (`npx playwright install chromium`, or set `PLAYWRIGHT_BROWSERS_PATH` to a directory that already holds `chromium-1194`).

```bash
# 1. A disposable database the fixture guard accepts (loopback host, or a name with e2e/test/dev/ci)
createdb fp_e2e
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fp_e2e
export FIXTURES_ALLOW=1

# 2. Schema (not done by the test run)
npx prisma generate
node scripts/migrate.js

# 3. Build + start the server, seed fixtures, run everything
npm run test:e2e

# Faster re-runs once .next/ is built from the current code
E2E_SKIP_BUILD=1 npm run test:e2e
E2E_SKIP_BUILD=1 npx playwright test --project=phone-390x844 e2e/journeys.spec.ts
E2E_SKIP_BUILD=1 npx playwright test --grep-invert @visual   # journeys + a11y only
npx playwright show-report                                   # HTML report (playwright-report/)
```

`npm run test:e2e` does, in order:

1. `webServer` runs `node e2e/support/serve.mjs`: `npm run build` (skipped with `E2E_SKIP_BUILD=1`), then `next start` on port 3100 with the E2E server clock shim.
2. `e2e/global-setup.ts` checks `DATABASE_URL` with the fixture guard (`assertFixtureTargetAllowed`, so it refuses production-like targets and requires `FIXTURES_ALLOW=1`), runs `npm run fixtures:seed` at the anchor, and deletes `login:*` / `login-fail:*` rate-limit rows so repeated runs do not hit 429.
3. The `setup` project signs in; the viewport projects run with one worker (they share one database).

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | Disposable database, same one the server uses. |
| `FIXTURES_ALLOW` | required `1` | Explicit opt-in for the fixture seed guard. |
| `FIXTURES_ANCHOR_DATE` | `2026-01-05T12:00:00Z` | Seed anchor, server clock and browser clock. Changing it invalidates the visual baselines. |
| `E2E_SKIP_BUILD` | unset | `1` = reuse the existing `.next/` build. |
| `E2E_SKIP_SEED` | unset | `1` = skip seeding and rate-limit cleanup. |
| `E2E_PORT` / `E2E_BASE_URL` | `3100` / `http://localhost:3100` | Server address. |
| `E2E_REUSE_SERVER` | unset | `1` = use a server already on the port. It must have been started by `serve.mjs`, or the dashboard data is wrong. |
| `E2E_TIMEZONE` | `America/Toronto` | Zone for the server `TZ` and the browser. Changing it invalidates the baselines. |
| `JWT_SECRET` | fake test-only value | Only for the E2E server. |
| `SHARED_DEVICE_ENABLED` | `1` (set by `playwright.config.ts` for the E2E server only) | Shared-device kill switch, on so `e2e/device.spec.ts` can run. It changes behaviour only for requests carrying device cookies, which no other spec sends. |
| `E2E_REPORT_DIR` / `E2E_OUTPUT_DIR` | `playwright-report` / `test-results/e2e` | Report and artifact folders (CI keeps one per step). |

## Clocks and determinism

Fixtures are anchored to a fixed instant (Monday 2026-01-05 12:00 UTC). Two clocks are pinned to it:

- **Browser:** an auto fixture in `e2e/support/test.ts` calls `page.clock.install({ time: anchor })` before any page script runs. Specs import `test`/`expect` from `./support/test`, not from `@playwright/test`.
- **Server:** server components compute "today/upcoming" from `new Date()`. `e2e/support/server-clock.cjs` is preloaded into `next start` only by `serve.mjs` (`NODE_OPTIONS=--require`). It shifts `Date.now()`/`new Date()` so the process starts at `E2E_SERVER_NOW` (the anchor) and then ticks in real time. It is a shift, not a freeze, so JWT expiry and rate-limit windows still work. It is never imported by app code, and it refuses to load under `NODE_ENV=production` unless `E2E_ALLOW_SERVER_CLOCK=1` is set, which only `serve.mjs` does.

Other sources of noise are also removed: reduced motion, `animations: 'disabled'`, hidden caret, 1× DPR, a fixed zone and locale, and fonts awaited before capture. The dashboard's chore and leaderboard queries now have a total `orderBy`. Before that, rows came back in Postgres physical order, which changed whenever the seed updated a row.

## Visual baselines

- Stored in `e2e/__screenshots__/<spec>/<name>-<project>-linux.png`: 28 images (login + dashboard light + dashboard dark, × 6 viewports; the fridge-mode Today board at 1280×800 and 800×1280, full page; and, at the same two sizes, the tablet pair and removed screens (full page), the parent-mode banner and the device list (element screenshots)).
- **Baselines are specific to Linux + Chromium.** Font rasterisation differs between operating systems and font sets, so macOS/Windows runs will not match. They also depend on the Playwright/Chromium version (1.56.1 / chromium-1194). Upgrading Playwright is a baseline review event.
- The committed baselines were generated in a Linux container (Chromium 1194, DejaVu Sans as the system UI font). They were verified stable across three consecutive runs and after a full fixture reset + reseed. If the hosted `ubuntu-24.04` runner renders fonts differently, the CI visual step fails with a diff. Regenerate on CI instead of locally: run the **E2E (Playwright)** workflow manually with `update_snapshots: true`, download the `e2e-baselines-<sha>` artifact, review every image, and commit them in a PR that says so.
- Masked regions: the dashboard date line and greeting (clock-derived; covered by a text assertion instead); on the Today board, the clock and the "Updated" time (the date is asserted as text). Keep masks minimal. A mask hides regressions too.
- Policy (`VISUAL_REGRESSION.md`): a diff must be inspected and explained in the PR. `npm run test:e2e:update` rewrites baselines. Never run it just to make CI green, and never update baselines for unrelated routes without an explanation.

## Accessibility allowlist

`e2e/a11y.spec.ts` fails on any `serious`/`critical` axe violation except entries in `A11Y_ALLOWLIST`. Each entry matches rule + page + **exact node selector**, so a new element failing the same rule still fails. Every entry must cite an open issue and is removed when the issue is fixed. `minor`/`moderate` findings are attached to the report (`axe-*.json`) but do not fail yet.

Current entries: **none**. The allowlist is empty and axe enforces every serious/critical rule on every scanned page.

Removed (fixed under #131 with text-safe semantic tokens in `src/app/globals.css`; `--warning` / `--danger` stay as decoration fills):

| Rule | Page | Node | Before | After |
|---|---|---|---|---|
| `color-contrast` | `/dashboard` | "Review" label, now `.text-[var(--warning-text)]` | 2.19:1, `#FF9500` on white | 5.28:1, `--warning-text` `#C93400` on white (light); 9.54:1, `#FFB340` on `#1C1C1E` (dark) |
| `color-contrast` | `/dashboard/chores` | `.btn-destructive` ("Reject") | 3.54:1, white on `#FF3B30` | 5.38:1, white on `--danger-fill` `#D70015` (both themes) |

The same change moved all `text-[var(--danger)]` error text to `--danger-text` (`#C4001A` light, 6.25:1 on white, 4.80:1 on `--danger-tint`; `#FF6961` dark, 6.03:1 on `#1C1C1E`) and gave the offline banner black text on the orange fill (9.55:1).

Fixed while adding the gate: on phone widths the top-bar home link had no accessible name because the wordmark is hidden below `sm` (axe `link-name`). It now has `aria-label="Family Planner home"`.

## CI

`.github/workflows/e2e.yml` runs on push/PR to `main`/`master` and on manual dispatch, on `ubuntu-24.04` with a `postgres:17-alpine` service and `permissions: contents: read`. Steps: `npm ci`, `prisma generate`, `npx playwright install --with-deps chromium`, `node scripts/migrate.js`, `npm run build`, then journeys + a11y (`--grep-invert @visual`) and visual (`--grep @visual`) as separate steps. On failure it uploads `playwright-report/` and `test-results/` (traces and screenshots of synthetic fixture data only). It is not a required check. Branch protection decides that.

## Known gaps / next steps

- Teen role journeys and meal journeys wait on the fixtures listed as deferred in `TEST_DATA.md`. Shared-device tablets are created per test by `e2e/device.spec.ts` through the real pairing flow rather than seeded. Not covered in the browser yet: the elevation countdown and idle/max expiry (unit-tested in the device client and server), the password fallback and PIN lockout, rate-limited pairing states, the pages with the kill switch off (the API 404s are route-tested; the E2E server runs with it on), and the 24-hour offline snapshot (#162).
- `/dashboard/settings` has older serious axe findings outside the tablet section (unnamed notification toggle buttons, low-contrast optional-field hints and the Delete Account button); `e2e/device.spec.ts` scopes its scan to the Tablet PIN row and dialog. They need their own fix before a full-page Settings scan is added.
- Grocery coverage is limited to the dashboard Shopping card (read-only); checking items off in the browser is not covered yet.
- Only Chromium. Android WebView/Capacitor lifecycle still needs device checks (`QA_MATRIX.md`).
- Snapshots cover login, dashboard and the fridge-mode Today board only. Meal and imported-calendar data for the board is inserted by `e2e/fridge.spec.ts` until meal fixtures land in the canonical dataset (#149). Add component/state galleries as #139 children land.
