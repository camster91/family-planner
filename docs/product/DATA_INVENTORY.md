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

## Rules
- Collect/store only what the product needs.
- Shared tablet receives the minimum fields needed for its purpose.
- Logs/analytics must not contain passwords/tokens, child names, message bodies, precise addresses, medical notes, private event descriptions, finance descriptions or arbitrary AI prompts.
- Provider integrations require a processor/data-flow entry before production.
- Export/deletion/retention must be defined per domain before broad launch.

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