# AI usage, quotas and estimated costs

Source candidate for #144/#123, 2026-10-22. No migration, runtime validation,
activation or release has occurred. The normal app stays available without AI.

## Scope and private rollout

The shared provider transport serves assistant, text capture and photo capture.
`FAMILY_AI_USAGE_READY=1` **and** `FAMILY_AI_USAGE_ROLLBACK_READY=1` are required
for new metered calls. Either flag adopts the controller; a partial opt-in or
READY=0 with ROLLBACK_READY=1 pauses calls rather than silently falling back to
unmetered mode. Keep rollback adoption on during pauses and use a rollback image
that implements these guards. Clearing both flags is not a supported post-adoption
rollback. New templates set both to0. No environment or deployment was changed.

`FAMILY_AI_PROVIDER_DISABLED=1` independently stops provider dispatch and withholds
replies in both APIs; it does not erase keys/settings or disable normal app work.
Deployment operators must roll this configuration through all replicas. After
adoption, the transport refuses calls missing a scoped observer. The existing
provider interface/configuration, public-address checks, pinned fetch for custom
endpoints, redirect refusal and30-second deadline remain. All requests now have
an8MB serialized input bound (capture HTTP bodies are streamed/bounded before JSON parsing), bounded streamed response (assistant64KiB,
capture256KiB), and explicit output ceiling (assistant1300/capture4096 tokens).
Providers may ignore requested ceilings; no provider billing guarantee is claimed.

## Canonical storage and admission

`database/migration-ai-usage.sql` and the matching Prisma source add:

- `AiUsagePolicy`: one household-owned revisioned policy; enabled flag, daily
  household/person limits, optional integer micro-USD monthly estimate limit and
  input/output rates per million tokens. Rates bind to an HMAC of the exact
  current provider endpoint/model/key. The hash is not a credential. No raw
  provider configuration is copied into these tables.
- `AiUsageRequest`: one server-generated reservation per admitted attempt. Only
  household/account attribution, fixed job/outcome/status, timestamps, nullable
  token/latency observations, numeric rate snapshot and estimated/reserved
  micro-USD. No prompts, replies, sources, titles, member names, email, photos,
  transcripts, URLs, model names, credentials or arbitrary metadata.

Raw SQL keeps old generated clients compatible before consolidated generation.
Storage readiness checks table presence and the three validated erasure FKs:
family delete cascades both tables; account delete nulls request attribution.
Missing/invalid storage or database admission failure stops the call; there is no
memory-only quota fallback. No schema was applied in this source checkpoint.

Reservation takes canonical user then household membership locks, renews current
person family/token generation/parent-or-teen role and exact provider config, and
reads policy under the same transaction. UTC household-day, person-day and
household-month counts include pending/failed attempts. Person counts span their
households; household counts survive member erasure without attribution. Default
limits are120 household attempts/day and40/person/day, configurable within bounded
ceilings. Existing hourly rate limits remain too. Only a reservation commit allows
transport dispatch. No network operation holds a membership lock.

A month estimate limit requires current parent-entered USD rates. Admission holds
a conservative byte-based input allowance plus requested output cap at those
rates. Known reported token counts replace the held estimate; absent/invalid
counts stay unknown and keep the hold. Unpriced historical calls in the current
month prevent cost-limited admission rather than being treated as free. Parent
controls explain how to use request limits only or review pricing. All arithmetic
uses integer micro-USD, with no floating-point currency persistence or assumed
provider price list. Vision billing, discounts and provider invoices may differ.

## Outcomes, privacy and recovery

A reservation starts with unconfirmed provider status. Process loss, disconnect
or failed finalization cannot prove that a call was sent, charged or free. No
quota is refunded on uncertainty and no provider retry is automatic. Finalization
uses a conditional pending-row update under the household lock and runs at most once; it never reattaches
an erased account or resurrects a deleted family. Nullable metadata is not zero.
Provider usage extraction accepts only bounded nonnegative integer token counts;
all other provider fields are ignored. Finalization failure logs only a fixed
content-free event and leaves the conservative reservation.

Before returning a successful reply, APIs recheck adoption/pause, current actor,
provider and policy revision. A pause/change during latency withholds the old
reply even if its household records still match. Existing assistant source leases,
canonical target permissions and explicit confirmations remain separate. Accepted
usage means a validated server2xx response, not delivery acknowledgement, user
acceptance, an application write or an accuracy score. Failed admissions before
reservation are not represented as paid attempts.

Each reservation lazily removes at most500 rows older than90 UTC days in its own
household. This is event-driven pruning, not a scheduler or a hard deletion SLO
for an idle household. Whole-household erasure cascades immediately; account
erasure removes attribution. Own-account export includes retained request metadata
without rates, costs, household IDs or other people's rows. Current parent policy
export renews the parent's current household/role and excludes the config hash.
Exports remain readable independently of activation flags.

## Parent API and UI

`GET /api/family/ai-usage` is private/no-store, current parent-person only with
paired-device refusal and membership/session renewal under locks. It returns
an owner binding, policy/revision, current provider fingerprint/host-model label,
pause/readiness flags and at most31 UTC daily aggregates. It exposes no per-person
breakdown or per-call timeline. Unavailable storage returns503, never a fabricated
zero. Prices/usage do not enter child, device, cache, board or AI provider DTOs.

`POST` accepts only a bounded strict owner/generation, expected revision, reviewed
config version and policy. Changed identity, policy revision or provider requires
refresh. Saving cannot silently bind old rates to a different provider/model/key.
No key, provider URL, model routing, subscription, purchase or provider call is
changed by this endpoint. Existing provider settings remain the owner of keys.

The parent Settings panel shows attempts, accepted replies, known/held estimates,
unknown price/token observations and measured latency. Daily activity and optional
cost fields are compact disclosures; rates and current provider context are
explicit. EN/ES copy, normal controls, min44px targets and keyboard-scrollable
history are authored. The projection is memory-only and original-owner bound;
blur/background/storage/owner replacement clears it. Unknown saves block replay
until a fresh read; revision comparison provides conflict handling. Saving the
existing provider form refreshes this projection so changed pricing is visible. This is not
an intake draft or an exactly-once provider receipt.

## Remaining acceptance

Source cases are authored/unrun for exact money/unknown values, transport quota
refusal before fetch, mandatory observer, partial activation, scoped API reads,
foreign owner/provider replacement, unavailable storage, UI unknown saves/owner
replacement, and disposable-DB concurrency/pause/erasure/CAS scenarios. These
mocks do not prove real PostgreSQL locking, FKs, migration/client compatibility,
network timeouts, costs, browser rendering or native behavior. No tests/types/
lint/build/browser/API/SQL/DB/client/native/CI ran. Consolidated QA remains after
all remaining code, followed by applicable release gates and authorized deployment.

#144/#123 still require confirmed-plan source checks, wider source-generation
coverage, canonical food/recipe/schedule planning, versioned semantic evaluation
fixtures/scoring and other remaining inbox/history/refusal source. Live model
quality and provider eligibility/activation are separate from these counters.

## Later source continuation — 2026-10-22

Canonical food plan ranking now uses the existing observer/quota/cost bucket,
with no unmetered fallback. Optional used/kept counts use the existing household
opt-in aggregate writer plus atomic minimal dedup receipts, never usage prompt
content. The parent report extension is negotiated for older-client compatibility.
Versioned canonical and explicit reviewed-provider evaluation builders now live in
`src/lib/ai-evaluation`; see `../testing/AI_EVALUATION.md`. They separate contract
matches, reviewer grades, unknown measurements and actual runtime acceptance.
No live model score, invoice, feature readiness or passing QA result is inferred.
All source remains subject to the final consolidated checks and release gates.
