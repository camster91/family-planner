# Family Planner — Fridge Tablet Program

**Owner:** Cameron Ashley  
**Status:** Planned  
**Product:** Family Planner  
**Primary surface:** Dedicated Android tablet in the home  
**Companion surfaces:** Mobile web / Android phone, later iOS if validated  
**Repository:** `camster91/family-planner`

## 1. Product decision

The fridge-tablet experience is a new primary interface for Family Planner, not a separate product or codebase. The existing household model, roles, calendar, lists, meals, chores, family management, security boundaries, deployment model, and Android Capacitor shell remain the foundation.

The goal is to turn Family Planner into a calm, always-available household command centre that works from several feet away and supports fast touch interaction at the fridge or wall.

The program is designed end to end: product discovery, Figma-first design, architecture, Android appliance behaviour, core household flows, food and meal intelligence, groceries, mobile companion workflows, AI assistance, security, privacy, accessibility, telemetry, testing, beta, release, operations, and commercialization.

## 2. Product promise

A family should be able to glance at one screen and answer:

- What is happening today?
- Who needs to be where, and when?
- What are we eating tonight?
- What food should we use soon?
- What do we need to buy?
- What household tasks need attention?
- What changed since I last looked?

The product should reduce coordination work rather than add another system to maintain.

## 3. Target experience

### Fridge dashboard

The home screen is optimized for 10–13 inch Android tablets in landscape first, with portrait support.

Primary regions:

1. **Today** — date, time, weather, upcoming household schedule.
2. **Family schedule** — colour/profile-aware events and departures.
3. **Dinner** — tonight’s meal, prep time, missing ingredients, start action.
4. **Use soon** — food nearing best-before or expiry.
5. **Groceries** — top unchecked items and quick add.
6. **Tasks** — urgent or due household work.
7. **Ask Family Planner** — contextual assistant entry point.

### Interaction rules

- Readable from several feet away.
- Large touch targets and minimal precision gestures.
- Most common actions complete in one or two taps.
- No hidden critical controls behind hover interactions.
- Persistent recovery from network loss and app restart.
- Child/teen/parent role restrictions remain enforced at API level, not just UI level.
- Dashboard content can be configured by household without turning the home screen into a widget-building project.

## 4. Scope

### MVP

- Dedicated tablet dashboard.
- Household sign-in and device registration.
- Family profiles and role-aware views.
- Today / week calendar summary.
- Shared shopping list.
- Meal plan and tonight card.
- Fridge, freezer, and pantry inventory.
- Best-before / expiry tracking.
- “Use soon” queue.
- Quick-add flows for events, groceries, meals, and inventory.
- Basic AI suggestions grounded in household data.
- Android full-screen appliance mode.
- Offline read cache and queued safe mutations.
- Responsive mobile companion experience.
- Telemetry, error reporting, backup and rollback coverage.

### Post-MVP candidates

- Barcode scanning.
- Receipt capture and item extraction.
- Recipe import from URLs.
- Voice entry.
- Calendar-provider sync.
- Automatic grocery generation from meals.
- Leftovers tracking.
- Smart-home integrations.
- Home Assistant integration.
- Photo screensaver.
- Advanced meal optimization.
- Paid family plan.
- Native iOS packaging.

### Explicitly out of initial MVP

- Proprietary hardware.
- Continuous location tracking.
- Open-ended autonomous purchasing.
- Automatic calendar writes without user confirmation.
- Health or medical decision-making.
- Paid integrations before demand is validated.

## 5. Product principles

1. **Glanceable first.** The tablet is an appliance, not a desktop dashboard shrunk onto a touch screen.
2. **Figma first.** Major tablet and mobile flows are designed and reviewed before implementation.
3. **One household model.** No parallel tablet-specific database or auth system.
4. **Offline tolerant.** Reading and common safe actions survive temporary connectivity loss.
5. **Role aware.** Parent, teen, child, and shared-device behaviour are explicit.
6. **Private by default.** Shared-screen content excludes sensitive parent-only data unless intentionally enabled.
7. **AI is assistive.** AI proposes and explains; normal household actions remain understandable without AI.
8. **Recoverable releases.** Every production promotion has tested rollback and data recovery paths.
9. **Evidence before breadth.** Usage data and household feedback determine later feature priority.

## 6. Existing foundation to reuse

Family Planner already contains:

- Household and member concepts.
- Parent/teen/child roles.
- Calendar.
- Shared lists.
- Meal planning.
- Chores and rewards.
- Feature flags.
- PostgreSQL / Prisma backend.
- Next.js / TypeScript application.
- Responsive web UI.
- Android Capacitor shell and APK workflow.
- Docker / Coolify deployment path.

The fridge program should extend this foundation rather than migrate to React Native unless a documented capability gap appears that cannot be solved cleanly with the existing Capacitor architecture.

## 7. Proposed architecture

```text
Android Fridge Tablet
        |
        | Capacitor shell
        v
Family Planner Next.js UI
        |
        +-- local cache / offline queue
        |
        v
Family Planner API
        |
        +-- PostgreSQL / Prisma
        +-- authentication and roles
        +-- household event stream / sync state
        +-- AI orchestration layer
        |
        +-- Calendar provider adapters
        +-- Weather provider
        +-- Recipe / food data providers
        +-- Notification provider
```

### Architecture requirements

- Household-scoped records by default.
- Device registration separate from human identity.
- Revocable shared-tablet sessions.
- Idempotent mutations for offline retry.
- Server timestamps for conflict resolution.
- Soft-failure behaviour for optional external providers.
- No provider secret embedded in the APK.
- Feature flags for incomplete modules.
- Audit trail for sensitive settings and device-management changes.

## 8. Data model reuse and additions

The fridge program must reuse completed consolidation work rather than introducing another generation of meal or shopping models.

### Existing models to inspect and reuse/canonicalize

The current Prisma schema already contains:

- `Recipe`
- `Ingredient`
- `RecipeIngredient`
- `MealPlan`
- `MealPlanEntry`
- existing legacy `FamilyMeal`
- generic shared-list `List` / `ListItem`
- `ShoppingList` / `ShoppingItem`

Issue #149 decides the canonical meal/recipe/grocery write paths and migration/compatibility role of the overlapping existing models before Phase 4 broad cross-domain writes. Do **not** create a third shopping-item model such as `ShoppingListItem` merely to avoid that decision.

### Genuinely new candidate models / extensions

- `HouseholdDevice`
- `DeviceSession`
- `DashboardPreference`
- `FoodItem`
- `FoodLocation`
- `InventoryAdjustment`
- `ExpiryObservation`
- `LeftoverItem` only after evidence supports it
- `AISuggestion`
- `AIActionProposal`
- `SyncMutation`
- `IntegrationConnection`
- extensions/version/idempotency fields on existing canonical models where required

Every new record that can expose household data must have explicit family ownership and authorization tests. See `docs/architecture/DATA_MODEL.md` and ADR-0005.

## 9. Shared-device security model

A fridge tablet is not equivalent to a parent’s private phone.

Requirements:

- Pair/register the device to one household.
- Allow a parent to revoke the tablet remotely.
- Shared dashboard session must not expose parent-only finance, settings, private messages, addresses, medical notes, tokens, or account-management controls by default.
- Parent-only actions require re-authentication or a short parent PIN where appropriate.
- Child/teen actions must be attributable without exposing parent credentials.
- Auto-lock or reduced-privilege mode after configurable inactivity.
- Device tokens are revocable and rotated.
- Offline cache is limited to data required for the dashboard and protected using platform-supported storage where feasible.

## 10. Android appliance mode

### MVP device behaviour

- Launch into Family Planner after device restart where Android permissions allow.
- Full-screen immersive mode.
- Prevent accidental navigation outside the app where kiosk / lock-task capabilities are available and intentionally enabled.
- Keep session resilient across WebView restart.
- Configurable screen-on window.
- Night dimming mode.
- Touch-to-wake behaviour where supported by the device.
- Orientation support with landscape-first design.
- Network reconnect handling.
- Offline dashboard snapshot.
- Update path that does not silently strand the household on a broken build.

### Hardware target

Design baseline:

- Android 12+.
- 10–13 inch display.
- 1280×800 minimum logical target.
- Wi-Fi.
- Optional front camera for later scanning / recognition use cases.

Do not require a particular tablet brand for the product to function.

## 11. Calendar program

### MVP

- Today summary.
- Week view.
- Household member colour / avatar context.
- Fast event creation.
- Recurring events already supported by the product where applicable.
- Timezone and DST-safe storage/display.

### Integration stage

Validate real household demand before implementing provider sync.

Candidate integrations:

- Google Calendar.
- ICS subscription/import.
- Microsoft calendar if household evidence justifies it.

Acceptance requirements include duplicate prevention, recurrence handling, deterministic conflict policy, deletion semantics, credential revocation, and import/sync auditability.

## 12. Food inventory program

### MVP inventory actions

- Add food item.
- Location: fridge / freezer / pantry.
- Quantity and unit.
- Optional category.
- Purchased/opened date.
- Best-before / expiry date.
- Mark consumed, discarded, or moved.
- “Use soon” ranking.
- Search and filter.

### Later capture methods

- Barcode scan.
- Receipt OCR / extraction.
- Camera recognition.
- Voice add.

All automated extraction should produce editable suggestions rather than silently creating high-confidence-looking bad inventory.

## 13. Meal planning and recipes

### MVP

- Weekly meal plan.
- Breakfast / lunch / dinner slots where desired.
- Tonight card on dashboard.
- Recipe detail.
- Prep / cook time.
- Household favourites.
- Ingredient matching against inventory.
- Missing ingredient list.
- Add missing ingredients to groceries.

Implementation must use the canonical existing models/API path selected in #149, not create duplicate recipe/meal-plan models.

### Later

- URL recipe import.
- Leftover planning.
- Batch cooking support.
- Dietary preference filters.
- Budget-aware planning if the existing budget module proves useful in practice.

## 14. Grocery workflow

The grocery list must remain useful without AI.

MVP:

- Real-time shared list.
- Categories / aisles.
- Quantity.
- Notes.
- Check / uncheck.
- Quick add from tablet and phone.
- Add missing recipe ingredients.
- Preserve completion history long enough to support undo and recurring suggestions.

The implementation must reuse the canonical existing `List`/`ListItem` or `ShoppingList`/`ShoppingItem` path selected by #149 and preserve import/provenance compatibility.

Later:

- Store-specific grouping.
- Reorder suggestions.
- Shopping-service integrations only after demand and economics are validated.

## 15. AI program

AI is a contextual layer over deterministic household data.

### Initial AI jobs

- Suggest meals using food already available.
- Prioritize food that should be used soon.
- Propose a short meal plan for a requested time window.
- Identify missing grocery ingredients.
- Answer schedule questions based on household calendar data.
- Convert natural-language requests into action proposals.

### Example

> We have an event at 5:30 and need to leave at 5:00. Suggest a dinner using food we already have that can be ready by 4:45.

### Safety and action policy

- AI may read only the household data authorized for the active role/device context.
- AI-generated writes are proposals until the user confirms any consequential change.
- No autonomous purchases.
- No autonomous deletion.
- No sending external messages without confirmation.
- Model prompts and logs must avoid unnecessary private household content.
- Store structured action results rather than relying on free-form assistant text for state changes.

## 16. Figma-first design program

Before implementation of each major stage, create:

- Tablet design tokens.
- Grid and responsive rules.
- Dashboard components.
- Calendar components.
- Meal card and recipe components.
- Inventory and use-soon components.
- Grocery components.
- Empty, loading, error, offline, sync-conflict, and success states.
- Parent re-auth / PIN flows.
- Device setup / pairing flow.
- Mobile companion variants.

Representative design frames:

- 1280×800 landscape tablet.
- 1920×1200 landscape tablet.
- 800×1280 portrait tablet.
- 390×844 phone.
- 430×932 phone.

## 17. Accessibility baseline

- WCAG 2.2 AA target for applicable web UI.
- Minimum 44×44 CSS pixel touch targets for primary controls.
- Logical keyboard focus for mobile/web support.
- Visible focus state.
- Semantic headings and labels.
- Screen-reader names for controls.
- Do not use colour alone to distinguish family members or status.
- Reduced motion support.
- Text zoom / reflow validation.
- High-contrast error and offline states.
- Tablet interaction must work without hover.

## 18. Offline and synchronization model

MVP target:

- Dashboard data remains viewable during short network interruptions.
- Shopping-list toggles and safe quick-add actions may queue locally.
- Queued mutations carry idempotency keys.
- User sees pending / synced / failed state.
- Conflicts do not silently overwrite newer server state.
- Sensitive or destructive actions require live server confirmation.

The first implementation may use a browser/Capacitor persistence layer; a native database is only introduced if measured reliability requires it.

## 19. Notifications

Tablet notifications should be intentionally limited to avoid turning the fridge into an alarm wall.

Candidate tablet alerts:

- Event starting soon.
- Meal-prep reminder.
- Critical sync or account problem.

Phone companion notifications can later handle:

- Grocery additions.
- Chore events.
- Calendar changes.
- Device offline / revoked warnings.

All notification categories must be configurable.

## 20. Telemetry and product evidence

Privacy-safe events:

- dashboard viewed;
- quick action started / completed;
- meal suggestion accepted / dismissed;
- inventory item added / consumed / discarded;
- grocery item added / completed;
- offline queue created / synced / failed;
- device paired / revoked;
- calendar event created;
- recipe-to-grocery action completed.

Do not send child names, message bodies, exact food notes, private event descriptions, addresses, or other unnecessary household content into analytics.

Key metrics:

- Weekly active households.
- Tablet days active per household.
- Dashboard opens / passive active sessions.
- Time to complete common actions.
- Grocery-list weekly usage.
- Meal-plan weekly usage.
- Inventory retention and correction rate.
- AI suggestion acceptance rate.
- Offline mutation success rate.
- Crash-free sessions.
- Cross-family authorization incidents: target zero.

## 21. QA matrix

### Viewports

- 390×844 phone.
- 430×932 phone.
- 768×1024 tablet.
- 800×1280 portrait tablet.
- 1280×800 landscape tablet.
- 1920×1200 landscape tablet.
- 1366×768 desktop support view.

### Core journeys

1. Pair tablet to household.
2. Dashboard loads correct household data.
3. Parent creates an event.
4. Household sees the updated schedule.
5. Add food item and expiry date.
6. Item appears in use-soon at correct threshold.
7. Plan dinner.
8. Identify missing ingredient.
9. Add missing ingredient to grocery list.
10. Check grocery item from phone.
11. Tablet reflects change.
12. Disconnect network and verify offline dashboard.
13. Queue safe mutation.
14. Restore network and verify exactly-once sync.
15. Revoke tablet and verify access ends.

### Failure cases

- API unavailable.
- Database unavailable.
- Session expires.
- Tablet clock is wrong.
- Duplicate offline retry.
- Integration provider unavailable.
- AI request times out.
- AI proposes invalid or missing record.
- Storage quota issue.
- WebView process restart.
- Device reboot.

### Security cases

- Two-household isolation.
- Parent-only field access from shared device.
- Teen / child role restrictions.
- Device token theft simulation where practical.
- Revoked device cannot refresh.
- Foreign family IDs rejected.
- Direct API requests cannot bypass dashboard UI restrictions.

## 22. Performance targets

Initial targets on representative mid-range Android hardware:

- Cached dashboard visible in <=2 seconds after warm launch.
- Interactive dashboard in <=3 seconds under normal Wi-Fi conditions.
- Quick local toggle feedback in <=100 ms.
- Server-confirmed common mutations in <=2 seconds p95 excluding provider outages.
- No unbounded dashboard polling.
- Images optimized and lazy-loaded outside the primary viewport.

These are engineering targets, not current measured claims.

## 23. Release strategy

### Environments

1. Local development.
2. Review environment.
3. Internal household dogfood.
4. Design-partner beta.
5. Production.

### Release gate

This fridge checklist **augments, and does not replace**, the authoritative release gate in `docs/PRODUCT_PROGRAM.md`. A production candidate must satisfy the authoritative Family Planner release requirements plus the fridge/Android-specific requirements below.

Before production promotion, require at minimum:

- exact commit SHA and immutable server image digest/artifact identity;
- clean/frozen install and Prisma client generation/validation;
- typecheck, lint, automated tests, production build, and production dependency audit;
- database migration rehearsal twice where applicable, with compatible old-client sequence;
- HTTPS review evidence for representative parent/teen/child/shared-device journeys;
- role/family isolation and direct negative API cases;
- Android APK/AAB build/install evidence for applicable client changes;
- tablet and phone responsive/accessibility QA;
- offline/reconnect/idempotency journey where applicable;
- fresh backup plus isolated restore evidence for risky data changes;
- previous healthy server image and Android artifact retained;
- tested/documented rollback procedure and known DB rollback limitations;
- crash/health monitoring and release/build identity active;
- post-deployment health, logs, release identity and core smoke verified;
- explicit production approval for the exact reviewed artifact.

Passing CI is not deployment approval. Merge approval is not production approval.

## 24. Rollback

Rollback planning must include both web/backend and Android client compatibility.

- Retain last known-good server image.
- Avoid irreversible schema removals in the same release that introduces replacements.
- Maintain backward-compatible API behaviour across the supported installed Android version window during staged rollout.
- Keep previous APK/AAB artifact available for controlled rollback/testing.
- Feature-flag incomplete or risky modules.
- Record release identity in health output.
- Do not assume application rollback makes database rollback safe.

## 25. Delivery phases

### Phase ordering rule

Phases 0–5 describe the primary build sequence. Phases 6–7 are **evidence-gated workstreams**, not automatic next steps. If the required household evidence is not available after Phase 5, begin/continue the design-partner beta/research work from #107/#108/#126 before implementing Phase 6 or 7. Phase 8 may therefore begin before Phase 6/7. Planning and low-risk contract research may occur earlier, but provider/capture implementation must not be justified by the phase number alone.

### Phase 0 — Program and product definition

Outcome: approved scope, architecture, design direction, risk register, metrics, and backlog.

Deliverables:

- This program.
- Master GitHub issue.
- Phase issues.
- Existing product-program integration.
- Agent-ready repository/source-of-truth foundation.

### Phase 1 — Fridge dashboard foundation

Outcome: current Family Planner data works in a true tablet-first home screen.

Deliverables:

- Tablet design system.
- Dashboard layout.
- Today / schedule.
- Tonight meal card.
- Grocery preview.
- Task preview.
- Shared-device-safe navigation.
- Loading, offline, empty, and error states.

### Phase 2 — Android appliance mode

Outcome: tablet behaves like a dependable household appliance.

Deliverables:

- Device registration.
- Revocable shared session.
- Full-screen mode.
- Startup / restart recovery.
- Display schedule and dimming.
- Offline snapshot.
- Installable signed beta APK/AAB path.

### Phase 3 — Food inventory and use-soon

Outcome: household can maintain useful fridge/freezer/pantry state without excessive work.

Deliverables:

- Inventory data model.
- Add/edit/consume/discard.
- Locations.
- Expiry / best-before.
- Use-soon ranking.
- Search / filters.
- Telemetry for correction and abandonment.

### Phase 4 — Meals, recipes, groceries

Outcome: dinner planning flows into what the household already owns and what it needs to buy.

Deliverables:

- Canonical existing recipe/meal/grocery model/API decision and migration adapters per #149.
- Meal slots / recipe details on the canonical path.
- Ingredient matching.
- Missing ingredients.
- Idempotent add-to-groceries.
- Mobile shopping flow.

### Phase 5 — Contextual AI

Outcome: AI reduces planning effort without becoming the system of record.

Deliverables:

- AI orchestration boundary.
- Household-context retrieval.
- Meal suggestions.
- Use-soon suggestions.
- Schedule-aware meal suggestions.
- Structured action proposals.
- Confirmation gates and audit evidence.

### Evidence checkpoint before Phase 6/7 implementation

Use the existing Family Planner design-partner programme (#107/#108) and/or the fridge-specific beta/research programme (#126) to identify actual calendar interoperability and capture friction. If no suitable external household evidence exists, Phase 6/7 implementation stays blocked while Phase 8 research begins.

Required evidence should answer:

- which calendar systems households actually use and whether import/sync is a repeated problem;
- whether manual inventory/recipe entry is causing measurable abandonment/correction friction;
- which integration/capture method produces the highest expected household value;
- whether provider cost/privacy/failure complexity is justified.

### Phase 6 — Calendar interoperability (evidence-gated)

Outcome: validated household calendars can feed Family Planner without duplicate or confusing events.

Deliverables only after the evidence checkpoint passes:

- Provider research from measured design-partner evidence.
- Google / ICS first only if justified.
- Conflict and recurrence policy.
- Credential lifecycle.
- Sync diagnostics.

If evidence does not support calendar interoperability yet, defer this phase rather than forcing a provider decision.

### Phase 7 — Capture automation (evidence-gated)

Outcome: adding food and plans becomes materially faster where measured friction justifies automation.

Candidate deliverables, only after evidence:

- Barcode scanning.
- Receipt extraction.
- Recipe URL import.
- Voice quick-add.

### Phase 8 — Beta, hardening, and commercialization

Outcome: external households prove whether the fridge experience deserves broader launch and provide evidence for later integrations/automation when earlier evidence is insufficient.

Deliverables:

- 5–10 design-partner households.
- Four-week usage study.
- Reliability and retention scorecards.
- Interview evidence.
- Calendar/capture friction evidence where relevant.
- Packaging and price validation.
- Go / revise / stop decision.

## 26. Commercial model hypothesis

Do not implement billing until the family beta validates repeated use and willingness to pay.

Possible packaging to test later:

- Free: household calendar, basic lists, basic tablet dashboard.
- Family Plus: meals, advanced inventory, automation, calendar sync, AI, history, premium household customization.

Pricing must be researched again at validation time. Existing Family Planner pricing hypotheses remain hypotheses, not approved commercial terms.

## 27. Operational ownership

Suggested ownership model:

- **Product:** Cameron.
- **Design:** Figma-first UX / visual system before implementation.
- **Application:** Family Planner repo.
- **Android:** Capacitor package in the same repo.
- **Backend:** existing Family Planner API and PostgreSQL.
- **Release:** existing Ashbi review / production workflow with explicit approval gates.
- **Support:** issue-based incident tracking with no private household data in GitHub.

## 28. Risk register

| Risk | Mitigation |
| --- | --- |
| Tablet UI becomes a cluttered admin dashboard | Enforce glanceable home-screen hierarchy and usability testing |
| Maintaining inventory is too much work | Measure correction/drop-off; add capture automation only where it removes real friction |
| Shared tablet leaks parent-only data | Dedicated device authorization model and negative API tests |
| Offline retries create duplicates | Idempotency keys and visible sync state |
| AI invents household state | Ground in structured records; require confirmation for writes |
| Android device vendors behave differently | Test representative stock Android / Samsung-class hardware and document limits |
| Calendar sync creates duplicates | External identity keys and deterministic conflict policy |
| Duplicate meal/list models diverge | Canonicalize existing models in #149 before broad cross-domain writes |
| Too many features delay useful release | Phase gates and evidence-based backlog |
| Web and APK releases become incompatible | Backward-compatible API window and staged rollout |
| External provider costs grow unexpectedly | Provider abstraction, quotas, telemetry, and approval before paid commitments |

## 29. Definition of done for the fridge program

The program is complete when:

- a dedicated Android tablet can be paired to a household and safely remain in shared use;
- the tablet dashboard reliably shows the household’s day, meal, use-soon food, groceries, and tasks;
- inventory, meal, and grocery flows work end to end on canonical data paths;
- mobile companion workflows keep the shared tablet in sync;
- offline / reconnect behaviour is tested;
- AI provides useful grounded suggestions with confirmation-gated writes;
- role and household isolation have automated and runtime evidence;
- accessibility and representative device QA pass;
- authoritative Family Planner release gates plus fridge-specific Android/recovery requirements pass;
- backup, restore, rollback, monitoring, release identity, and Android/server compatibility are proven;
- external household beta evidence supports a launch decision;
- commercialization is only implemented after explicit validation and approval.

## 30. Current sequencing decision

Planning this program does **not** invalidate the existing Family Planner launch and safety backlog. The current P0/P1 security, release, migration, email, QA, and design-partner work remains the prerequisite for treating the expanded fridge experience as production-ready.

The fridge program may proceed in design, architecture, and non-production implementation work in parallel where it does not weaken those release gates. Evidence-gated Phase 6/7 work may be deferred while beta/research proceeds rather than forcing integrations before real household demand exists.
