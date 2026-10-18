# Emergency form and recovery alignment — #499

Emergency cards retain their existing canonical API, household ownership and role policy: signed-in household members can read cards, parents can change them, and paired shared devices are refused. This slice changes no schema, profile association, provider or stored medical values.

The Add/Edit form uses the shared form sheet with fixed actions and three optional disclosure sections for medical details, doctors/insurance, and emergency contacts/notes. Person name receives initial focus and a localized required-field error. Raw form values remain unchanged. English/Spanish examples and preview controls live in a route-scoped dictionary. Only the 17 owned visible-copy inventory records are removed; the original print CSS inventory record and unrelated bytes remain unchanged.

Deletion uses a shared confirmation dialog, an immediate exclusive mutation lock, pending navigation protection, a retryable failure and explicit focus on Add Card after success. Permission lookup failure exposes a retry without exposing editing controls. Validated contact refreshes reconcile the selected preview by ID and clear it when its card disappears. PATCH responses never fabricate canonical records from local draft values.

## Observed local checks

- Full TypeScript check passes.
- 23 existing/affected mounted, API isolation and copy-inventory cases pass across three suites. Only two bounded deletion and disclosure-keyboard cases are added; required-name and initial-focus coverage extend an existing save journey.
- Deletion coverage checks refusal, retained draft, retry, duplicate prevention, Escape protection, canonical removal and restored keyboard focus.
- Scoped ESLint, application/catalog formatting and tree secret scan pass.
- Optional disclosure summaries remain in the dialog keyboard path through explicit native tab stops.
- No shared Prisma generation or dependency install was performed.

## Remaining acceptance

Optimized exact-head build, rendered EN/ES sheet/print/preview behavior, responsive accessibility review and original hosted gates remain pending. Local mounted checks do not establish browser or production acceptance. Existing inventory browser pending-write coverage remains unchanged. No merge or deployment is claimed for this slice.

Profile association through `person_id` remains a separate canonical-data decision; this change does not invent a profile mapping for legacy free-text cards.

A bounded browser spec now collects four active EN/ES phone/desktop journeys (eight declared viewport skips plus three existing setup cases). It checks optional-section keyboard access, blank-name refusal, failed-save raw draft retention, accessibility/overflow and captures form/preview/print with runtime identity. Collection is verified; execution is pending. Successful E2E shards now retain selected feature screenshots and Emergency runtime receipts for seven days, without changing thresholds or required checks.
