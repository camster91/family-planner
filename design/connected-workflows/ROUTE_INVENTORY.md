# Source route disposition — November 2, 2026

Source baseline: `c9e2ec1c1562ff9de034fecce31e55deda742637`. This is a source inventory, not a rendered app audit. Route groups and intercepted routes remain listed individually. Grouping is provisional; controls in child components require manual inspection. No feature is removed by this inventory.

| Source | Journey | Next disposition |
|---|---|---|
| `src/app/(auth)/forgot-password/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/(auth)/login/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/(auth)/register/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/(auth)/reset-password/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/(auth)/verify-email/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/@forms/(.)allowance/create/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/@forms/(.)calendar/create/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/@forms/(.)calendar/edit/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/@forms/(.)chores/create/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/@forms/(.)chores/edit/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/@forms/(.)chores/routines/page.tsx` | Responsibilities and progress | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/@forms/(.)lists/create/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/@forms/(.)projects/create/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/@forms/(.)rewards/create/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/@forms/[...rest]/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/@forms/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/allowance/create/page.tsx` | Private money | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/allowance/page.tsx` | Private money | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/analytics/page.tsx` | Responsibilities and progress | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/anniversaries/page.tsx` | Time and coordination | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/budget/imported/page.tsx` | Private money | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/budget/page.tsx` | Private money | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/calendar/create/page.tsx` | Time and coordination | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/calendar/edit/page.tsx` | Time and coordination | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/calendar/page.tsx` | Time and coordination | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/calls/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/chores/create/page.tsx` | Responsibilities and progress | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/chores/edit/page.tsx` | Responsibilities and progress | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/chores/page.tsx` | Responsibilities and progress | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/chores/routines/page.tsx` | Responsibilities and progress | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/chores/schedules/independent/page.tsx` | Responsibilities and progress | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/chores/schedules/page.tsx` | Responsibilities and progress | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/emergency/page.tsx` | Care and permitted sharing | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/family/create/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/family/invite/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/family/more/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/family/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/family/settings/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/features/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/handoff/page.tsx` | Care and permitted sharing | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/help/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/inventory/page.tsx` | Food: discover → plan → shop → cook → reuse | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/lists/[listId]/page.tsx` | Collections and projects | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/lists/create/page.tsx` | Collections and projects | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/lists/groceries/page.tsx` | Collections and projects | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/lists/page.tsx` | Collections and projects | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/lists/type/[type]/page.tsx` | Collections and projects | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/locations/page.tsx` | Time and coordination | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/meals/explore/page.tsx` | Food: discover → plan → shop → cook → reuse | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/meals/page.tsx` | Food: discover → plan → shop → cook → reuse | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/meals/recipes/[id]/page.tsx` | Food: discover → plan → shop → cook → reuse | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/meals/review/page.tsx` | Food: discover → plan → shop → cook → reuse | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/messages/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/notes/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/notifications/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/pickups/page.tsx` | Time and coordination | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/profile-link/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/projects/[id]/page.tsx` | Collections and projects | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/projects/create/page.tsx` | Collections and projects | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/projects/page.tsx` | Collections and projects | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/review/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/rewards/create/page.tsx` | Responsibilities and progress | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/rewards/page.tsx` | Responsibilities and progress | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/search/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/settings/activity/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/settings/devices/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/settings/imports/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/settings/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/sick-days/page.tsx` | Care and permitted sharing | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/today/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/travel/page.tsx` | Time and coordination | Retain; inspect composition and role/state behavior |
| `src/app/dashboard/wishlist/page.tsx` | Collections and projects | Retain; inspect composition and role/state behavior |
| `src/app/dev/design-system/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/device/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/device/pair/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/device/removed/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/device/today/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/handoff/[token]/page.tsx` | Care and permitted sharing | Retain; inspect composition and role/state behavior |
| `src/app/join/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/privacy/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
| `src/app/terms/page.tsx` | Household, home or supporting flow — inspect individually | Retain; inspect composition and role/state behavior |
