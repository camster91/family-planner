# Family onboarding source reconciliation

Original #446 under #132/#128. Source inventory: 2026-10-20. No runtime,
rendered, provider or household acceptance is claimed by this requirement map.

| Original criterion | Canonical implementation | Remaining evidence |
| --- | --- | --- |
| Successful dashboard creation reaches step three rather than refresh away | OnboardingFlow validates a canonical returned family ID and sets step 3; ambiguous results reconcile the current account through `/api/auth/me` without automatically repeating POST | Existing success/invalid-response/ambiguous-commit test source; actual authenticated creation and rendering deferred |
| Prompt everyone: parents, teens, children; explicit canonical invites; finish later | Add Everyone describes account versus shared-screen profiles, retains explicit email/role/send controls using `/api/family/invites`, links `/dashboard/family/invite`, and offers Finish later/Continue | Existing invitation response/role/roster/localization source; actual invitation and family flows deferred with isolated fabricated data |
| Standalone creation also prompts member setup | `/dashboard/family/create` renders the same canonical OnboardingFlow for an account without a family instead of maintaining a second client | Route/auth/reload/role execution deferred |
| Failure retains family draft and cannot duplicate pending creation | The name remains local state; a synchronous submission ref now gates Enter/click before the pending React render. Composing Enter does not submit. Finally releases the ref after settled mutation/reconciliation | New same-turn Enter/click/IME/failure source is authored but unrun |
| Unknown creation readback is recoverable | Membership readback now reuses the bounded fetch-plus-JSON helper (2500ms). Stalled fetch/body returns unknown, keeps draft and does not advance; late resolution cannot apply state or auto-repeat creation | New stalled-fetch and stalled-body/late-response cases authored but unrun |
| Original policy and email-free boundary remain | No API/schema/auth/role/email-policy change, fabricated email or automatically sent invite. The separately gated #480 profile surface has its own parent-scoped compatibility read; refusal shows unavailable rather than claiming activation | Full profile/account/link/device/lifecycle/provider acceptance remains separate and deferred |

The create mutation itself is not automatically timed out, replayed or aborted;
the new bound is on its read-only reconciliation after an ambiguous outcome.
An explicit later retry retains the existing server household guards. No durable
local family data, new idempotency protocol or scheduler is introduced.

Rollback removes the scoped client guard/readback changes or the Add Everyone
presentation while retaining canonical family and invite APIs. Consolidated QA
must execute failure, ambiguous commit, pending history, create-once, locale,
role, roster/profile and actual direct/dashboard navigation checks. This pass ran
no tests, types, lint, build, browser/native/schema or CI operations and performed
no household creation, invitation, push, merge, deployment or activation.
