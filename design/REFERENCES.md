# Curated Design References

These links are inspiration/research inputs. Do not copy screens, assets, layouts or branded visual systems wholesale.

## Primary principles
### Apple Human Interface Guidelines / Design Resources
Use for clarity, hierarchy, touch target discipline, restraint, typography thinking, motion/feedback principles and coherent system behaviour. Adapt for Android platform conventions instead of reproducing iOS chrome.

## Product reference: fridge hub
### Everblog 13.4" FridgeCal
https://everblog.com/products/everblog-13-4-inch-fridgecal-calendar

Chosen by Cameron (#262) as the design reference for the fridge/wall surface, including the Today board and the
meal, recipe and grocery views of #252. As described on the product page: a 13.4" 16:10 touchscreen
(1920×1200) mounted on a fridge with magnets, showing the family calendar, a chore chart with rewards, food
inventory, recipes, a shopping list and the weather at a glance, with a profile per family member.

**Borrow conceptually:** one landscape screen that answers "what's happening today" from across the kitchen;
calendar, chores, dinner, shopping and weather side by side rather than behind navigation; a consistent colour per
family member; large touch targets for a wall-mounted screen.

**Avoid:** copying its screens, layouts, icons or branding; per-member data that Family Planner keeps private on a
shared surface (SHARED_DEVICE.md §9, ROLE_AND_ISOLATION_MATRIX.md); rewards/points on the shared board (the board
never shows gamification fields, #248); colour as the only way to tell members apart.

**How #262 applies it (original to Family Planner):** the existing Today board regions laid out as four columns at
16:10 (1280×800 and 1920×1200) with larger type and ≥56 px targets at 1920×1200; member colours from the existing
module tint tokens, always beside the member's name; an opt-in weather tile in the header; a reserved grid slot for
the "Use soon" inventory tile (#263). Recorded in `src/components/fridge/TodayBoard.tsx` and
`docs/testing/E2E.md` (baselines).

## Dribbble references
### Luma — Smart Home In-Wall Tablet UI
https://dribbble.com/shots/27155100-Luma-Smart-Home-In-Wall-Tablet-UI

**Borrow conceptually:** always-available wall-tablet calmness, glance zones, large touch areas, strong environmental hierarchy.

**Avoid:** copying its exact card geometry, composition, iconography or brand language.

### Smart Home Dashboard
https://dribbble.com/shots/5684790-Smart-Home-Dashboard

**Borrow conceptually:** central dashboard hierarchy, simultaneous information regions, quick-control density without desktop-table clutter.

**Avoid:** decorative dashboard density that makes family tasks feel like home automation telemetry.

### Mise — Meal Planner App UI
https://dribbble.com/shots/27663402-Mise-Meal-Planner-App-UI

**Borrow conceptually:** food photography/graphic hierarchy, meal-card confidence, weekly planning structure, appetizing but functional presentation.

**Avoid:** making meal imagery dominate the household dashboard or hiding utilitarian details.

### Noisy List — Shopping List Management
https://dribbble.com/shots/26524960-Noisy-List

**Borrow conceptually:** fast list scanning, satisfying completion, collaborative quick entry and clear item hierarchy.

**Avoid:** excessive novelty gestures or visual noise for a high-frequency grocery flow.

### Smart Grocery Mobile App
https://dribbble.com/shots/26317231-Smart-Grocery-Mobile-App-UI-UX

**Borrow conceptually:** category cues, quick-add, one-handed mobile shopping ergonomics.

**Avoid:** ecommerce assumptions; Family Planner groceries are a shared household list first, not a store catalogue.

## Product-specific visual questions
The Figma reference audit should answer:
- How can a 1280×800 tablet be readable from 1–2 metres away yet useful at touch distance?
- How should time-sensitive schedule information outrank decorative content?
- How does “Dinner tonight” feel appetizing without becoming content-heavy?
- How are use-soon/expiry states noticeable without alarmist colour?
- What original illustration language works for empty/offline/sync/onboarding states?
- Which controls belong on tablet versus phone?
- How does night mode stay legible without lighting the room?

## Originality rule
Each design proposal should record what reference principle informed it and what makes the resulting component/flow original to Family Planner.