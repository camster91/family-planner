# Product quality review — October 2026

Canonical scope: #499 and parent #128. Bounded repairs: #540–#543.

## Baseline and evidence

The review started from released main `ae23f5d8d618732aa6f665b7515ef45071b6e8ce`.
Three agents reviewed core journeys, roles/data minimization, and AI/support/recovery.
One observer rendered fabricated parent journeys at phone, fridge and desktop sizes,
enabled all 22 fixture feature flags, and restored them afterward. No real
household content, provider, physical device or store was used.

The observer's 79/100 estimate is expert judgment for the reviewed web journeys.
It is not a market ranking or customer validation. Its rubric was usefulness
25, ease of setup/use 25, responsive/accessibility 20, reliability/privacy 20,
and assistance/support 10. More tests do not themselves earn quality points.

Local warm baseline (10 samples per endpoint after two warmups): Today page
p95 21.9ms; eight authenticated core API paths p95 3.2–5.6ms. This is loopback
performance on the development host, not physical-device or production latency.

## Selected repairs

| Issue | Observed problem | Bounded outcome |
| --- | --- | --- |
| #540 | Chat connection/provider failures display raw errors; read-only choices and local validation can strand proposals | Localized draft-preserving message/choice retry; editable preflight failures; uncertain writes offer read-only reconciliation |
| #541 | Child/teen server page passes unused Event fields through its client boundary | Explicit household-scoped selection and minimal title/time/location DTO |
| #542 | Fridge grocery continuation is clipped; desktop week wraps 4+3; Bulk competes with Add Meal | One grocery scroll owner with reachable controls; seven-day desktop row; context-aware primary action; failed refresh blocks fresh bulk actions |
| #543 | Explore hidden at tablet widths; More is a long flat list; unavailable calendar setup has no useful explanation | Responsive discovery, existing metadata groups, truthful read-only/provider guidance with working destinations |

Regression-first mounted tests cover the source/data and recovery changes.
Independent reviewers check another agent's changes, with root owning the
combined production-build rendered pass. Final candidate, CI and release
outcomes belong in the linked issues/PR and #499; this baseline review does not
claim those later gates passed.

## Rendered regression

`e2e/product-quality.spec.ts` uses real routes and fabricated signed-in fixtures.
English/light and Spanish/dark run at all six configured viewport projects,
with an extra 1024px navigation resize. Checks cover discovery, each enabled
More destination once, provider-off connection guidance, seven-day layout,
Bulk sheets, long grocery/use-soon data, keyboard scrolling, fully contained
continuation controls, minimum touch targets and scoped Axe checks.

AI transport is intercepted locally: rejected fetch, provider 503, exact
message retry with a newer draft, and an uncertain action response. No provider
or domain mutation is executed by these transport tests. Existing ordinary
journey/role tests remain required for affected behavior. Runtime commit,
compiled build timestamp and source tree identify the candidate; tests reject
unbuilt tracked app changes. Fixture flags and owned inventory/audit rows are
restored or removed with loopback guard and ownership checks.

Use a disposable loopback database with fixture opt-in and blank provider keys.
Generate the client and run migrations first. Do not reuse an arbitrary server:
the ordinary runner supplies the matching browser/server clock.

```sh
npx prisma generate
npm run typecheck
npm run lint
npm run format:check
npm test -- --runInBand
npm run build
npx playwright test e2e/product-quality.spec.ts
```

## Remaining product evidence

Grounded household AI capabilities/evaluations, replay receipts for all AI
writes and stale destructive proposals remain under #144/#464/#472.
Email-free profile parity stays dormant under #480/#473. Native voice/wake,
offline cold launch, signing/store, physical fridge/phone/tablet and customer
usability/retention acceptance remain under #128 and its existing phases.
No permission, provider, scheduler or feature capability is enabled by this pass.

Rollback restores these presentation/query changes without changing records or
schema. API machine codes are additive; existing statuses/error strings and
supported clients remain compatible. Merging and deployment require the
existing exact-candidate QA, authorization and release-provenance gates.
