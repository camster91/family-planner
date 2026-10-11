# All-on More and Features discovery QA

`e2e/all-on-feature-discovery.spec.ts` covers the remaining parent discovery and customization slice for #499.

Each Playwright viewport project runs the parent route in English/light and Spanish/dark. The spec verifies:

- all 22 registry flags are represented in the intercepted feature contract;
- Family → More shows Chores plus each enabled non-tab feature exactly once by canonical href;
- feature labels, descriptions, links, and switches remain keyboard reachable with 44px targets;
- the More and Features main regions have no horizontal overflow and no serious or critical scoped Axe violations;
- Points & streaks can be disabled through an intercepted `PATCH /api/family/features`, and dependent Rewards/Analytics switches and More links become unavailable through the existing effective-feature rule;
- `/api/version` returns the compiled commit/tree identity and every feature transport response is the expected status;
- no POST/PATCH/PUT/DELETE other than the intercepted feature PATCH is observed.

The test rewrites the dashboard's serialized feature seed and intercepts the feature API. It does not change `Family.features`, create domain records, call providers, or exercise shared-device/native/customer acceptance. Teen Add Event and the four kid personal-feature links remain covered by `e2e/all-feature-role-controls.spec.ts`; this spec owns only the parent More/Features surface.
