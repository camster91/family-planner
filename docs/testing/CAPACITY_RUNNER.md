# Capacity engine implementation — #137

2026-10-24. **Authored source only; unrun.** No fixture, adapter, application,
database, load, provider or resource measurement was executed. This does not
complete the clean-environment reproducibility criterion.

## Present source

`src/lib/capacity/model.ts` constructs the four fixed local stages from
`CAPACITY_MODEL.md`. Reference/beta require an explicit ordinary/calendar/food/
history profile so each skew can be exercised separately. Larger mixed stages
use70/10/10/10 household composition. Traffic ordinals exclude two sentinel
households. Seeded per-worker streams choose the eight weighted scenarios,
parent/teen/child60/25/15 attribution, shared20% of Today/grocery starts and
2–5-second think times. A hot run puts half of starts in the first10% of the
traffic pool and half in the remainder; this avoids accidentally making55%
of starts hot through a second uniform draw.

`src/lib/capacity/runner.ts` exposes `runCapacityStage` without a CLI or import-time
action. It requires all eight scenario adapters, canonical before/after
reconciliation and a resource-limit callback. The caller must explicitly adopt
`CAPACITY_ALLOW=local-fabricated-v1`, pass the existing fixture/database and
loopback-application guards, and supply an exact40-character source commit.
Fixed stage ceilings cannot be increased through the supplied plan. This checks
declared targets; it does **not** sandbox adapter code or prove that a server
uses the declared database. Binding the server, fake providers and fixtures is
still mandatory adapter/adoption work.

Warmup and measured periods are separate. Each worker permits one in-flight
scenario, bounded to60 seconds. Adapters receive the15-second per-request rule;
the engine cannot enforce HTTP/body timing inside arbitrary adapter code.
Adapters must use canonical request helpers for that. A scenario timeout or
exception stops the entire stage; it never releases a timed-out slot to another
scenario. Abort may be ignored, so stopped stages do not perform concurrent
post-reconciliation or claim all effects settled. Preserve their report and
inspect the owned process/database before another run. No automatic replay,
rerun, stage escalation, seed/reset or teardown is included.

Workers are concurrency slots, **not counted authenticated users or sessions**.
Adapters must resolve each ordinal/role/surface to an exact fabricated session
and preserve real authorization. Draws happen per scenario start; the engine
reports actual actor starts rather than claiming a measured active-user mix.
Session-pool construction and per-client polling cadence remain adapter work.
The model's target virtual-session stages cannot be claimed from worker counts.

The engine stops on unsafe outcomes, failed preflight/postflight reconciliation,
resource-limit signals, unknown/failed outcomes above1% of the last60 seconds
(after the first measured minute), and its100,000-sample per-scenario memory
ceiling. These are harness stops, not revised production SLOs. All supplied
callbacks, including reconciliation/resource checks, have bounded waits.

## Report and interpretation

The returned object contains fixed scenario names, exact declared source/model/
stage, stop reason, reconciliation booleans, warmup/measured starts, observed
worker concurrency, actor-start counts, scenario-duration p50/p95/p99/max and
adapter-reported requests/response-byte counts. It excludes payloads, URLs,
account/household identifiers, credentials, cookie headers and raw exceptions.
No report is automatically written or published.

Scenario duration is client harness wall time. Request amplification/bytes are
adapter reports, not independently instrumented transport measurements. Server,
database and provider metrics remain explicitly unmeasured/synthetic-required.
Unknown/cancelled scenarios contribute to duration/outcome accounting; a low
error rate under reduced closed-loop arrivals is not a throughput proof.

## Missing before a usable end-to-end run

- Guarded deterministic dataset builder using canonical constructors and a
  versioned row-count/schema manifest, including the two sentinel households.
- All eight real route/domain adapters with exact household/role/device identity,
  idempotency keys, receipts, continuation, review/Undo and semantic assertions.
- Provider/delivery fakes and process/database binding adoption, with refusal of
  live provider dispatch and proof that the target server uses the isolated DB.
- Canonical before/after outcome reconciler and post-abort inspection procedure.
- Resource sampler, fixed-route request metrics and clean owned-process setup.
- Cold/warm run orchestration, exact build/schema/client/fixture identity and
  resource-limit manifest; report storage and final evidence review.
- Authored regression cases and actual clean-environment execution when QA resumes.

No command is offered as a working mixed-load test before these pieces exist.
The existing sequential `perf:baseline` command remains separate. No #137
runtime/reproducibility/capacity/drill acceptance box is checked by this source.
