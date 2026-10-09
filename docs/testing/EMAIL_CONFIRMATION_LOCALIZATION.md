# Explicit email-confirmation localization (#437)

## Scope and canonical behaviour

Typed scoped EN/ES route presentation covers heading, brand instruction, missing-token guidance, loading, confirm/pending/sign-in actions and four semantic outcomes. English outcomes reuse unchanged `VERIFY_MESSAGES`; translations render from semantic outcome state in the current mounted locale. Shared dictionary, verification helper/API, token/provider policy and canonical link/redirect are unchanged. Ordinary English wording and semantic roles remain compatible. Brand substitutions are interpolated after pseudolocalization and remain exact.

Opening `/verify-email`, mounting/re-rendering, changing language or following a mail-scanner link never POSTs. Only explicit confirm consumes the raw query token using the existing helper. Already-verified and invalid hide confirmation; rate-limit/network/malformed failures retain explicit retry. Verified uses replace(`/login?verified=1`), sign-in link stays `/login`; raw provider errors are not displayed.

## Observed local evidence

Ten regression-first mounted tests failed on original source, then passed after localization. The affected6suites/67cases include existing confirmation/helper/safe-redirect/API contracts, key/parameter parity, branded EN/ES ordinary/expanded rendering and exact raw parameter substitution, pending/late/already-visible language changes, token/body/count/no-auto-POST and retry/outcome compatibility. Inventory1512→1504 removes exactly8owned page occurrences. Prisma generate/validate, types, lint, full/owned formatting and final379suites4568tests pass (62.455s;188existing opt-in skips). The first full run caught a scoped loading literal in the shared key guard; a typed route copy helper corrected it without changing the guard, and the complete suite passed afterward. Final staged-source export matches all1432tracked blobs; root-relative unchanged-config redacted secret scan passes. An initial outside-root scan prefixed paths and missed the existing narrow fake-idempotency-key allowance; the six findings were existing fixture paths, and the correct-root scan required no config/ignore change. No unobserved new-source build/browser pass is claimed.

## Original hosted rendered gate

`e2e/email-confirmation-localization.spec.ts` adds EN/ES anonymous journeys at phone390x844, portrait800x1280 and fridge1280x800. All verification requests are intercepted with synthetic tokens/responses and off-origin requests blocked. Ten captured states: missing, ready, pending, server-error, network, rate-limited, malformed, invalid, already-verified and canonical redirect. Seven explicit requests have exact same raw token/body/path/method; no GET/mount POST. Scoped panel keyboard/focus/44px/hit/reflow/serious-critical WCAG checks apply to confirmation states; redirect capture proves route/navigation only, not full login-page accessibility. Actual runtime commit/build and ordinary/expanded mode are asserted and attached.

The existing isolated public QA job separately compiles ordinary0/0 and expanded1/1 static pages; only its two command arguments gain the new spec. Existing recovery cases, ordinary viewport matrix, visuals, fixtures/budgets/guards, action pins/triggers/permissions, services/timeouts, artifact retention and two-result aggregate stay identical. A structural deep-equality check and25-result truth table verify that preservation. Artifact/source identity, result sets, actual PNGs/hash/dimensions and scoped rendered review must be observed before merging. Low local disk and historical07d9 compilation are not substitute proof; original hosted exact-source compilations remain mandatory.

## Acceptance limits and rollback

Original #437 criteria remain unchecked until all original exact-head hosted/source/rendered/current protection/conversation gates pass and a normal merge/ancestry readback/owned cleanup completes. Implementing-agent review is not independent human acceptance. Full #142 localization, login/register feedback, provider delivery, legal/native/store/production/real-household requirements remain open. Rollback is a normal scoped source/dictionary/inventory/browser/workflow revert; no migration or API/auth/provider policy change.

## First hosted failure and genuine harness correction

Original c25a0e1c run37917701958 public QA compiled ordinary runtime9631bf70d61da7d15d1015cb5f3875db35207a9a and passed all6existing recovery cases;6confirmation cases failed at the first error assertion because unscoped `getByRole("alert")` also selected Next.js's `__next-route-announcer__`. Retained artifact11610488284/60,537,213bytes and reports prove that exact cause. Expanded compilation/cases were skipped after ordinary failure and are not claimed passed.

Only confirmation notice selectors now scope to `.auth-panel`, consistent with the existing recovery spec. The intended message expectation, all10states,7exact intercepted raw-token requests, no automatic POST, accessibility targets, retries/timeouts/projects/outcome checks and workflow coverage are unchanged. This is a genuine selector correction; original runs/history/artifact remain retained and no red source is merged. The corrected exact source requires its own original ordinary/expanded reports/compilations and complete hosted/rendered/current normal gates before acceptance.
