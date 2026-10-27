# Versioned household AI evaluation — #144

Source authored 2026-10-22. Nothing in this document establishes an executed pass,
provider eligibility, safety certification, activation, deployment or app rating.
The user requires all remaining code before consolidated QA; the commands below
are instructions for that later phase, not commands run at this checkpoint.

## Offline canonical contract evaluation

`src/lib/ai-evaluation/contracts.ts` defines fabricated inputs and independent
expected facts for fifteen cases: expiry/use-soon contribution, scaled missing
quantities, stock counted once, continuous cooking before departure, unknown
scaled duration, unresolved existing commitments, invented/foreign/deleted refs,
changed source revision, clarification shape, injected actions, child refusal,
malformed food output and an incomplete event intent. It invokes canonical pure
planner/timing/schema/reference functions. It never dispatches a provider, connects
to a database, changes readiness flags or writes household records. Importing it
does not run the evaluation.

`report.ts` emits fixed case IDs/dimensions/outcomes only. Duplicate cases, wrong
dimensions and arbitrary metadata refuse. Missing required cases stay in the
score denominator; an empty run has no accuracy percentage and cannot pass.
The percentage measures **fixture contract matches**, not model answer accuracy,
clarification correctness in natural language, prompt-injection resistance of a
real model, dietary suitability, safety or product quality. Provider semantics,
cost/latency and runtime acceptance remain explicitly unmeasured. A successful
contract gate cannot set AI release acceptance.

Later QA commands:

```sh
npm run test:ai:contracts
WRITE_AI_CONTRACT_REPORT=1 npm run test:ai:contracts
```

The second form writes the content-free report to the existing ignored
`test-results/ai-contract-report.json`, including failing case IDs. The ordinary
Jest suite also discovers these cases. Neither command authorizes provider use,
flag activation, migrations, production data changes or rollout.

## Reviewed provider observations

`provider-report.ts` separately validates the eighteen-case reviewed profile:
the fifteen canonical scenarios plus provider timeout, rate limit and original
unknown-result retry. Private QA input/output handling must follow existing
household/provider authorization; this module never invokes a model or API.

Input is `herewoven.ai-reviewed-observations.v1`, fixture version
`household-ai-reviewed.2026-10-22.v1`, an opaque configuration hash and one row per
case. Rows permit only output digest, explicit review marker/time, nullable
intent/grounding/schema/refusal-or-clarification grades, nullable usable-reply
observation, bounded observed latency and nullable integer micro-USD estimate.
No prompts, replies, recipe details, identifiers, URLs, credentials, provider names
or free-text notes enter this report. Digests identify evidence, not a proof that
review occurred; retain the authorized private source evidence separately.

Grades must come from actual review against the fixture's expected facts and
current canonical records. Do not synthesize passing rows from this offline suite
or treat a well-formed citation as proof that prose is correct. Unreviewed grades
remain null. Correctly handled refusal/timeout can pass a case without becoming
a successful usable-reply job. Missing and duplicate cases cannot establish a
complete run. Scores include their measured counts, so partial review is visible.

Unknown token price, billing or timing stays unknown, never zero. Known cost
subtotals and unpriced-job counts remain separate. Per-success cost divides the
estimated cost of **all observed jobs, including failed attempts**, by reviewed
successful usable-reply jobs. It is withheld if any observed job has an unknown
cost, an unknown reply outcome, or a usable reply whose success classification
still lacks review/grades. The report exposes unknown success-classification
counts and its explicit all-observed-jobs basis; integer averages round up to a
micro-USD. Missing required cases remain visible and block the complete gate;
this observed-sample metric never claims population coverage. The quality-observation gate and complete-observation gate are separate,
so unknown cost is visible rather than forcing a fabricated price to mark a
correct refusal. Existing request quotas/conservative reservations still govern
actual provider admission. These are estimates, never invoice reconciliation.

A reviewed report still cannot establish role/isolation, database locking,
source renewal during latency, atomic receipts, unknown recovery, installed-client
compatibility, browser/accessibility/device behavior, provider permissions or
production/customer acceptance. Run the existing dedicated API/real-PostgreSQL/
transport/owned-journal suites and release gates against the final candidate.
No report automatically enables AI or approves a release.


2026-10-25 source correction: failed-attempt costs now remain in the per-success
numerator, and unknown costs/classifications hold the metric. Existing source
fixtures were extended, UNRUN. No report/evaluation, tests/checks/build/browser,
provider call, DB/CI/release or activation was executed; actual measured quality,
latency and cost remain unavailable. This source-only correction does not accept
AI release or change provider quotas/billing.
