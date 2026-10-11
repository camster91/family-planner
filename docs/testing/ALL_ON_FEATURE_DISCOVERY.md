# All-on More and Features discovery QA

`e2e/all-on-feature-discovery.spec.ts` covers the remaining parent discovery and customization slice for #499.

Each Playwright viewport project runs the parent route in English/light and Spanish/dark. The spec verifies:

- the authenticated person is the Family A parent on a loopback test target, and all 22 registry flags are represented in the canonical feature contract;
- Family → More shows Chores plus each enabled non-tab feature exactly once by canonical href;
- feature labels, descriptions, links, and switches remain keyboard reachable with 44px targets;
- the More and Features main regions have no horizontal overflow and no serious or critical scoped Axe violations;
- Family A is snapshotted, enabled through the real parent `PATCH /api/family/features`, and verified with a canonical `GET` before rendering. Points & streaks can then be disabled through the real UI/API, and dependent Rewards/Analytics switches and More links become unavailable through the existing effective-feature rule;
- `/api/version` returns the compiled commit/tree identity and every feature transport response is the expected status;
- a context-level request firewall rejects non-loopback requests and any local POST/PATCH/PUT/DELETE outside the feature-row PATCH (with login POST allowlisted for setup) before dispatch, while recording blocked mutation attempts;
- no unallowlisted POST/PATCH/PUT/DELETE is observed or blocked;
- the exact original feature map is restored and verified with a canonical `GET` even when the assertions fail, with owned feature-audit cleanup attempted separately.

The test changes only the disposable Family A `Family.features` row through the real parent API and restores the exact snapshot in cleanup. It does not rewrite dashboard HTML/RSC seeds, fabricate feature API responses, create domain records, call providers, or exercise shared-device/native/customer acceptance. Teen Add Event and the four kid personal-feature links remain covered by `e2e/all-feature-role-controls.spec.ts`; this spec owns only the parent More/Features surface.
