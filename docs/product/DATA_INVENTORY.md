# Data Inventory

This document is the engineering source for privacy review and future Play Data Safety answers. It must be reconciled against actual code before public release.

## Classification levels
- **Public/product:** non-user-specific product metadata.
- **Household shared:** intended for authenticated household members/shared surfaces.
- **Parent-sensitive:** finance/admin/account details not for general shared display.
- **Highly sensitive:** credentials/tokens, precise private location, medical notes and equivalent high-risk content.
- **Telemetry-safe:** event metadata explicitly approved for analytics without private content.

## Domain inventory
| Domain | Example data | Default visibility | Shared-tablet cache? | Telemetry content |
|---|---|---|---|---|
| Account/auth | email, password hash/session/token | account owner/server | No | status only |
| Household/member | name, role, avatar | household | limited/purposeful | pseudonymous IDs/role where needed |
| Calendar | title/time/location/notes | household subject to role | purpose-limited; avoid sensitive details | action/status, not private text |
| Chores/tasks/rewards | assignment/status/photo | household/role | approved fields only | outcome/status |
| Groceries/lists | item/quantity/check state | household | Yes for approved lists | action/status, avoid note text |
| Meals/recipes | meal/recipe/ingredients | household | Yes | usage outcome, avoid free-form notes |
| Inventory | food/quantity/expiry/location-in-home | household | Yes for approved fields | event outcome, not notes |
| Messages | message body/attachments | household/private context | No by default | never message content |
| Finance | transactions/budgets/allowance detail | parent/explicit role | No by default | aggregate/product events only |
| Addresses/locations | precise address/coordinates | parent/explicit role | No by default | never precise value |
| Medical/sick-day | illness/medication notes | parent/explicit role | No by default | no medical content |
| Device | device/session/last seen | parent/admin + server | minimal local identifiers | pair/revoke/status |
| AI | authorized context and proposals | scoped to requesting context | no broad transcript cache by default | cost/latency/outcome, not prompt content |
| Beta usage counts (#287) | per household, UTC day and fixed metric name: a count (`BetaMetricDaily`) | not shown in the app; account export; `npm run beta:scorecard` (households as numbers) | No | the counts are the telemetry: no user id, role, text or content; per-household opt-in, default off; 13 months; deleted on opt-out and with the household |
| Legacy page views/clicks (#136, #140) | `Activity` rows `event_page_view`/`event_cta_click` written before this change: raw browser path (could include record ids) and client metadata, tied to a user | not shown in the app (feed and analytics page exclude them); the member's own account export until pruned | No | **no longer collected**: `POST /api/analytics/event` stores nothing; existing rows are deleted 90 days after they were written (pruned per household on that endpoint and on the activity feed read, `src/lib/legacy-analytics.ts`) and with the member or household |

## Rules
- Collect/store only what the product needs.
- Shared tablet receives the minimum fields needed for its purpose.
- Beta criteria are measured only through `src/lib/beta-metrics.ts` (fixed metric names, counts only) (decision D-6). The old page-view helper `src/lib/analytics.ts` is removed and the app records no page views (#136, #140).
- Logs/analytics must not contain passwords/tokens, child names, message bodies, precise addresses, medical notes, private event descriptions, finance descriptions or arbitrary AI prompts.
- Provider integrations require a processor/data-flow entry before production.
- Export/deletion/retention must be defined per domain before broad launch. The account export
  (`GET /api/users/export`) carries household-shared domains plus the member's own rows in the per-person
  domains (allowance, wishlist, sick days, medications, emergency card, anniversaries, pickups, notes, saved
  places, handoffs, upload metadata, chore assignments, calendar subscriptions/connections, push
  registrations, budget categories), with the role rules of each domain's GET route and no secrets: the
  exact keys and redactions are in `docs/architecture/API_CONTRACTS.md` "Export completeness, analytics days
  and the event list" and `docs/ROLE_AND_ISOLATION_MATRIX.md` "Account export".

## Local submitted grocery adds (#135)

The shared-tablet offline queue stores submitted grocery text (1–200 characters), canonical list id,
attribution-only member id, operation key and bounded retry state in the existing reserved `fp-device`
IndexedDB/localStorage namespace. These are household-shared operational records, never analytics.
No notes, price, finance/medical fields, names, passwords or session tokens are included. The queue
holds at most 50 operations; creates stop replay after 24 hours, failed/conflict records are removed
by the existing seven-day cleanup, and device purge removes the namespace. Unsent form drafts remain
memory-only and are cleared when hidden. Replay goes only to the existing same-origin authorized
grocery create route, with live permission checks. The local support report includes only counts,
states and rates, never this payload or its identifiers. No provider or automatic remote telemetry
is added. See `architecture/OFFLINE_SYNC.md` and `architecture/SHARED_DEVICE.md` for exact behavior.

## Third-party processor register
Maintain for each provider:
- purpose;
- data sent;
- legal/privacy links;
- retention/control configuration;
- credential location;
- regions if relevant;
- failure/revoke path;
- feature kill switch.

Do not add a provider to production without security/privacy review and explicit approval for credentials/spend where applicable.

## Play submission rule
Reconcile this table against actual dependencies, network calls, Android permissions, server integrations and production configuration before completing Data Safety declarations.