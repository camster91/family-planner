# Current State

**Last reconciled:** 2026-09-29, against `master` at `32f10d00221aff9959ad7365492b5ce4a498370b` (#281)
**Repository:** `camster91/family-planner`
**Protected default branch:** `master`

This is a dated snapshot. Inspect GitHub and executable source again before changing code or reporting status. Sources used: `git log --first-parent origin/master`, the `.env*.example` files, `.github/workflows/*.yml`, `android/`, and the GitHub API (pull requests, issues and workflow state) on 2026-09-29. Live repository settings, secrets and production health were **not** re-verified.

## Planning and baseline

- PR #129 (`plan/fridge-tablet-program`) **merged on 2026-09-23** as merge commit `2538499`. The canonical planning files (`AGENTS.md`, `docs/START_HERE.md`, `docs/engineering/**`, `docs/FRIDGE_TABLET_PROGRAM.md`) are on `master`.
- PR #101 (`codex/launch-readiness-gaps`, head `c19121d`) and the reconciliation candidate PR #172 were both **closed without merging on 2026-09-23**. The per-change disposition of #101 is recorded in [`decisions/PR101_DISPOSITION.md`](decisions/PR101_DISPOSITION.md) (awaiting owner sign-off; #167 stays open until then).
- PR #116 (CI noise reduction) merged as `aae427a`.

## Merged on master since the baseline

First-parent history from #221 (`cd1d78c`, 2026-09-24) to `32f10d0`:

| Commit    | Date  | PR   | What                                                                                                                  |
| --------- | ----- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| `784b40b` | 09-24 | #228 | Repository review fixes: security, household isolation, chores/XP, dates, infra                                       |
| `68843ff` | 09-24 | #229 | Household isolation audit of every API route + two-household fixtures                                                 |
| `a67570d` | 09-25 | #230 | Playwright E2E gates, docs reconciliation                                                                             |
| `b564b87` | 09-25 | #231 | E2E-found bug fixes                                                                                                   |
| `4ea4867` | 09-25 | #233 | Remove remaining placeholder data                                                                                     |
| `ada5ca3` | 09-25 | #234 | WCAG AA tokens, grocery fixtures + E2E, **Android security tests (replacing the generated `Example*` tests) and AAB** |
| `de87123` | 09-25 | #235 | Role and isolation decisions (#102) + read-only ICS import (#232)                                                     |
| `862f447` | 09-25 | #236 | Chore photo upload ownership (D3)                                                                                     |
| `8e4f4b2` | 09-25 | #237 | Today board for the fridge tablet (#119, #159)                                                                        |
| `403535c` | 09-25 | #239 | Shared-device session contract (#157, ADR-0006)                                                                       |
| `b8d50e4` | 09-26 | #243 | Shared device: schema, device auth and API (#240)                                                                     |
| `0347f28` | 09-26 | #244 | Login timing check fix                                                                                                |
| `ca9db39` | 09-26 | #245 | Shared device web UI (#241)                                                                                           |
| `2fd6cc5` | 09-26 | #246 | Android cookie flush on pause; Back backgrounds `/device` (#242, code only)                                           |
| `e292cd1` | 09-27 | #247 | Sync foundation: idempotency records and bounded offline queue (#162)                                                 |
| `77b7c03` | 09-27 | #249 | ADR-0007 canonical meal/recipe/grocery/list models (#149)                                                             |
| `c42174f` | 09-27 | #255 | Points/streaks/leaderboard become an opt-in family setting (#248)                                                     |
| `d913799` | 09-27 | #256 | Canonical schema expand + dry-run backfill tooling (#250)                                                             |
| `716006f` | 09-27 | #257 | Meal/recipe/grocery APIs on canonical models (#251)                                                                   |
| `10b8f3c` | 09-28 | #258 | Recipe ingredients to groceries, idempotent with undo (#253)                                                          |
| `8561736` | 09-28 | #259 | Meals and grocery UI on canonical models (#252, code only)                                                            |
| `9acc064` | 09-28 | #266 | Two-way Google/Outlook calendar sync, off until configured (#264)                                                     |
| `87df41f` | 09-28 | #267 | Food inventory with expiry, "use soon", "what can I cook" (#263)                                                      |
| `57909e0` | 09-28 | #275 | Parent-only fridge photo scan, off until configured (#265)                                                            |
| `ce6203c` | 09-28 | #276 | FridgeCal-style 16:10 fridge hub, member colours, opt-in weather, Use soon tile (#262)                                |
| `baf165e` | 09-28 | #277 | Review-first event import from text, photo or PDF (#270)                                                              |
| `211523e` | 09-28 | #278 | Grocery lists sorted by store section (#273)                                                                          |
| `63ec7c4` | 09-28 | #279 | One calm home, five tabs, Undo instead of confirm (#268, #269)                                                        |
| `cbef026` | 09-28 | #280 | Picture routines for young kids; parent Verify/Reject that change the chore (#272)                                    |
| `32f10d0` | 09-29 | #281 | Visible sync ("Updated N min ago", change polling) and the calm fridge display with night hours (#271)                |

Earlier merges on the same line include #221 (hosted build), #226 (server-side feature gates), #224, #223, #222, #220, #173 (#168 lookup rate limit), #116 and #129.

## Verified source baseline

- Exact dependencies/scripts: `package.json`; schema: `prisma/schema.prisma`. Do not copy version numbers into prose.
- Auth: self-hosted JWT/session. `src/lib/supabase/server.ts` is legacy-named and is not proof of Supabase auth.
- Android: Capacitor project under `android/`, `applicationId` `com.ashbi.familyplanner`, `versionCode 1`, `versionName "1.0"` (`android/app/build.gradle`). The generated `ExampleUnitTest`/`ExampleInstrumentedTest` were removed in #234. Current tests: `ManifestSecurityTest`, `CapacitorConfigSecurityTest`, `SharedDeviceNavigationTest` (JVM) and `AppIdentityInstrumentedTest` (instrumented). Versioning policy and build commands: [`architecture/ANDROID.md`](architecture/ANDROID.md).
- Deployment path: `release.yml` `Release to VPS` runs only on manual `workflow_dispatch` on the default branch and uses `.github/scripts/deploy-over-ssh.sh` / `deploy-vps.sh`. See [`engineering/CI_AND_RELEASE.md`](engineering/CI_AND_RELEASE.md).
- Legacy deploy path: `scripts/webhook-receiver.sh` is not supported and must not be installed without Cameron's approval.
- Scheduled jobs: no workflow has a `schedule:` trigger.

## CI

Workflow files on `master`: `release.yml`, `e2e.yml`, `apk.yml`, `auto-merge.yml`, `stale-issues.yml`.

| Workflow                         | GitHub state (API, 2026-09-29) | Role                                                                                                                                                                                                                                       |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `release.yml` — `Build & Test`   | active                         | **Required check** (branch protection observed 2026-09-24, see CI_AND_RELEASE.md). Passed on master pushes for #278 (`211523e`) and #279 (`63ec7c4`); #280 (`cbef026`) and #281 (`32f10d0`) passed Build & Test and E2E on their PR heads. |
| `release.yml` — `Release to VPS` | active                         | Manual dispatch only; production deploy, owner-gated.                                                                                                                                                                                      |
| `e2e.yml`                        | active                         | **Informational**, not required (the workflow's own header comment). Passed on `211523e` and `63ec7c4`.                                                                                                                                    |
| `apk.yml`                        | **`disabled_manually`**        | Last run 2026-09-08 (run 177, PR #101 head `ef75581`). No Android CI runs on master changes until it is re-enabled.                                                                                                                        |
| `auto-merge.yml`                 | `disabled_manually`            | Not in use.                                                                                                                                                                                                                                |
| `stale-issues.yml`               | `disabled_manually`            | Manual-dispatch only anyway.                                                                                                                                                                                                               |

GitHub also still lists a `VPS Docker probe` workflow (`vps-docker-probe.yml`, `disabled_manually`) whose file is no longer on `master`.

## What is on and what is off by default

Server kill switches and provider keys, from `.env.example` (local) and `.env.production.example` (production template):

| Feature                                   | Env                                                                                                                                                                                                                            | Local template          | Production template | Also needs                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Shared household tablet (#157/#240/#241)  | `SHARED_DEVICE_ENABLED`                                                                                                                                                                                                        | `false`                 | `false`             | Cameron's approval to turn on; when off every `/api/device/*` route returns 404 and device cookies are ignored          |
| Today board weather via Open-Meteo (#262) | `WEATHER_ENABLED` (on only for `1`/`true`)                                                                                                                                                                                     | `true`                  | `false`             | Each household opts in in Family settings (default off); Open-Meteo terms review in `product/THIRD_PARTY_PROCESSORS.md` |
| Two-way calendar sync (#264)              | `CALENDAR_TOKEN_KEY` (+ `CALENDAR_TOKEN_KEY_PREVIOUS`), `APP_URL` or `NEXT_PUBLIC_APP_URL`, and per provider `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET` (`MICROSOFT_TENANT`) | commented out (dormant) | empty (dormant)     | OAuth app registration; runbook `runbooks/CALENDAR_SYNC.md`                                                             |
| Fridge photo scan (#265)                  | `INVENTORY_SCAN_ANTHROPIC_API_KEY` (`INVENTORY_SCAN_MODEL`, `INVENTORY_SCAN_DAILY_LIMIT`)                                                                                                                                      | commented out (off)     | empty (off)         | Paid provider: Cameron's approval; route 404 and button hidden while unset; runbook `runbooks/INVENTORY_SCAN.md`        |
| Event import from text/photo/PDF (#270)   | `EVENT_IMPORT_ANTHROPIC_API_KEY` (`EVENT_IMPORT_MODEL`, `EVENT_IMPORT_DAILY_LIMIT`)                                                                                                                                            | commented out (off)     | empty (off)         | Paid provider: Cameron's approval; route 404 and Import hidden while unset; runbook `runbooks/EVENT_IMPORT.md`          |
| Recurring-chores cron endpoint            | `CRON_SECRET`                                                                                                                                                                                                                  | empty (fails closed)    | empty               | Scheduling it needs Cameron's approval (AGENTS.md)                                                                      |
| Rate-limit client address                 | `TRUSTED_PROXY_HOPS`                                                                                                                                                                                                           | `1`                     | not in template     | Must match the real proxy chain at deploy                                                                               |

Per-household feature flags (`src/lib/features.ts`): `inventory`, `gamification` (points/streaks; on for households that predate #248 via `legacyDefault`), `wishlist`, `locations`, `pickups`, `allowance`, `travel`, `handoff` and `sick-days` default off for new households; `rewards` and `analytics` require `gamification`.

## Canonical data (ADR-0007)

[ADR-0007](architecture/adr/0007-canonical-meal-recipe-grocery-models.md) (accepted 2026-09-27): `FamilyMeal`, `Recipe`/`Ingredient`/`RecipeIngredient` and `List`/`ListItem` are canonical; `MealPlan`, `MealPlanEntry`, `ShoppingList`, `ShoppingItem` are frozen legacy tables. Children A–D (#250–#253) are merged. The production backfill run and the destructive contract (#254) are both still owner-gated. Route-by-route mapping: [`refactor/ROUTE_AND_DOMAIN_INVENTORY.md`](refactor/ROUTE_AND_DOMAIN_INVENTORY.md).

## Open items blocked on the owner

1. **#254 destructive contract** of the legacy meal/shopping tables: gated on the backfill, a zero-legacy-traffic release cycle, a verified backup and Cameron's explicit approval.
2. **#242 Android device evidence**: pairing, cold/warm launch, rotation, process kill and revoke on a real Samsung-class and stock tablet. Code merged in #246.
3. **Production backfill run** (`runbooks/MEALS_GROCERIES_BACKFILL.md`): even a production dry-run needs approval for that run.
4. **Deploy**: nothing after the last owner-reported deploy (`b408170`, 2026-09-23, per the PR #101 closing comment) is recorded as deployed. `Release to VPS` needs its SSH environment secrets (not observed on 2026-09-24) and `TRUSTED_PROXY_HOPS` set to the real proxy chain.
5. **AI keys and spend caps**: `INVENTORY_SCAN_ANTHROPIC_API_KEY` and `EVENT_IMPORT_ANTHROPIC_API_KEY` stay empty until Cameron approves the provider and sets provider-side spend caps and the `*_DAILY_LIMIT` values.
6. **Open-Meteo terms review** before `WEATHER_ENABLED` goes on in production (`product/THIRD_PARTY_PROCESSORS.md`).
7. **Calendar OAuth app registration** with Google and Microsoft, then the calendar-sync envs.
8. **#252 design review** of the shipped meal/recipe/grocery views against the FridgeCal reference (`design/REFERENCES.md`), or recorded acceptance of the current composition.
9. **Email forwarding** for event import: choose an inbound-mail provider and set MX/DNS (`architecture/CALENDAR_IMPORT.md`, "Email forwarding (dormant design)").
10. **Re-enabling `apk.yml`** (and configuring Android signing secrets if release builds are wanted).
11. **Amend any provisional decision** in `decisions/PROVISIONAL_OWNER_DECISIONS.md` (O-15, O-16, O-17, the #101 disposition, #252) that turns out wrong.

## Work in flight

- Open owner product decisions have provisional answers approved on 2026-09-29 (`decisions/PROVISIONAL_OWNER_DECISIONS.md`); follow-ups are #285 to #289.
- This docs PR also fixes two bugs the inventory and #101 disposition found: reset/verify tokens accepting the stored hash (D-1, security) and notes edit/delete calling the wrong route (F-1).
- #121/#158 inventory completion merged as #284; #274 merged as #283.
- Household search (D-2, the search half of F-3): `GET /api/search` and a working `/dashboard/search` page, plus "Search the household" in the command palette. Household-scoped, canonical tables only, per-feature and per-role (matrix "Household search"), refused on a paired tablet.
- D-3 account and household deletion, with the Settings part of F-3: Settings → Data Export downloads `GET /api/users/export`, the unimplemented Two-Factor Authentication entry is removed, and Delete Account opens an in-page dialog (export first, current password, typed `DELETE` or household name). `DELETE /api/users` deletes one account with hand-over of household content; `DELETE /api/family` deletes the whole household for its only parent (`src/lib/account-deletion.ts`). Both routes changed their request contract (password and confirmation now required); see `architecture/API_CONTRACTS.md` and [`product/ACCOUNT_DELETION.md`](product/ACCOUNT_DELETION.md). Before this, `DELETE /api/users` failed with 500 for a parent who had created meals, notes, recipes and similar (RESTRICT keys) and otherwise cascaded away chores/events/lists they created; `DELETE /api/family` needed no re-authentication and left member accounts behind without a household.
- In progress: the F-2/F-4/F-8/F-9 fixes.
- Other open PRs: #260 and #261 (Dependabot), #238 (draft docs).

## Approval state

Documentation and non-production implementation may proceed in reviewed PRs. This snapshot does not authorize a merge, production deployment, Play publication, secrets/DNS/access/billing changes, spending, participant outreach or destructive production data changes.
