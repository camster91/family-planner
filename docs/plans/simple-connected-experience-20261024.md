# Selected connected experience — Glance and act

Cameron selected option 1, Glance and act, in this thread. This restores the
recorded direction after the earlier unpublished checkout disappeared. The
original image assets and earlier implementation commits have not been
recovered; this document does not claim a new visual review or acceptance.
Canonical execution remains #499, with existing feature issues retaining their
original criteria. Use the current household/auth/backend and existing editors.

## Selected behavior and current recovery

| Requirement | Current source disposition | Remaining work |
| --- | --- | --- |
| Compact Today controls | Reconstructed: Add disclosure for allowed event/chore creation, Explore, Today controls with existing list/meal/refresh/settings destinations | Original role/device/keyboard/rendered acceptance is deferred |
| Short sibling schedule and chore sections | Reconstructed source: separate calendar/chore Regions inside the existing NextUp slot, bounded rows, individual empty states, preparation/backlinks and original action callbacks | Later rendered/role/keyboard acceptance; source is unverified |
| Personal two-column composition | Reconstructed source: personal grid stays two columns at tablet/desktop; schedule/chore pair spans the NextUp slot; dedicated fridge grid and saved order remain separate | Later responsive/layout acceptance; source is unverified |
| Day-preserving dinner navigation | Reconstructed source: DinnerRegion receives the viewer calendar day, including empty dinner; mealDayHref preserves planner query/fragment and sets date-only start | Internal recipe/prep continuation source is reconstructed below; later acceptance is deferred |
| Honest grocery summary | Canonical board query is already grocery-only. Source repair uses the total, not loaded preview length, for clear-state wording; positive remaining totals retain continuation to `/dashboard/lists/groceries` | Later optimistic-preview/continuation/empty/multiple-list acceptance remains |
| Connected meal context | Reconstructed source: MealContextLink carries validated `start` through Explore/detail/back/plan/prep links; an edited meal day overrides viewed week for its recipe link. Existing MealViewNav and reuse editors keep canonical week/default-day behavior | Later navigation/draft/role acceptance remains; only the day context is carried, not arbitrary source query parameters |
| Helper: Help, Today and Add | Reconstructed source: AssistantQuickStart has three EN/ES sections with local Help, role/feature-filtered current-plan links and canonical editor/recipe/meal/prep destinations. Today includes existing saved-work recovery links; draft-aware navigation and busy guards stay in source | Later rendered/role/draft/voice/provider acceptance remains; chat, reports and explicit write review stay separate |

No additional chat-to-Capture transfer protocol is part of this bounded design.
Use provider-independent manual destinations and existing canonical confirmation
flows. Do not add a second assistant write path, provider requirement, global
role grant, background scheduler or speculative storage protocol.

## Completion boundaries

Every restored source slice stays unverified until the later user-authorized QA
pass. Earlier reported results belong to the absent earlier tree; they cannot be
applied to this reconstructed candidate. No test, build, lint, typecheck, browser,
CI, push, merge, deployment, provider, hardware or store work runs under the
current no-QA instruction. Closing a planning tracker never establishes native
or production acceptance. Current source/checkpoint status belongs in #128 and
the existing completion ledger; do not create duplicate feature issues.
