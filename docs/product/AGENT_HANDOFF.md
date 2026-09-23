# Agent Handoff

Use this when starting a fresh coding-agent session.

## Objective
Build/refactor Family Planner into the roadmap in issue #128: a premium Android-first household command centre with a dedicated fridge/wall tablet and companion phone experience.

## First reads
`AGENTS.md` -> `docs/START_HERE.md` -> `docs/CURRENT_STATE.md` -> assigned issue -> relevant architecture/design/testing docs.

## Current first-wave order
See `docs/engineering/EXECUTION_ORDER.md`. Do not jump to AI/Play publication before the foundational design/data/device contracts exist.

## Product rules
- one product/backend/household model;
- real canonical data only in production UI;
- shared tablet is least privilege, not parent login;
- original premium design, Figma-first for significant UX;
- phone + 1280×800 tablet are first-class;
- offline-safe actions are explicit/idempotent;
- core app works without AI/providers;
- privacy/security/accessibility are release gates.

## Work style
One scoped issue -> implementation plan -> vertical PR -> actual verification -> stop at approval gate.

Do not merge/deploy/publish/change production secrets or data unless explicitly approved.

## Definition of done
`docs/engineering/DEFINITION_OF_DONE.md`

## Master references
- #128 programme
- #130–#146 cross-cutting quality workstreams
- #84/#85/#102–#110 existing release/security programme

If you discover stale/contradictory docs, correct them or surface the conflict rather than guessing.