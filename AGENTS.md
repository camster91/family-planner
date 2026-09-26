# AGENTS.md — Family Planner operating contract

This file is the primary instruction set for coding agents working in this repository.

## Read first
1. `docs/START_HERE.md`
2. `docs/CURRENT_STATE.md`
3. `docs/FRIDGE_TABLET_PROGRAM.md`
4. Parent roadmap issue #128 and the issue assigned to you
5. Relevant architecture/testing/design docs for the area you are changing

If documents disagree, follow the authority order in `docs/START_HERE.md` and surface the conflict in the PR. Do not silently choose an older plan.

## Product direction
Family Planner is a private, role-aware household operations app. The fridge/wall Android tablet is a primary shared surface, not a second product or backend. Phone experiences are companion surfaces. The product should feel calm, premium, delightful and obvious while remaining Android-appropriate, accessible, private by default and recoverable.

## Current baseline
- Next.js App Router + TypeScript strict mode
- PostgreSQL + Prisma
- Self-hosted JWT/session auth
- Tailwind/design tokens and reusable React components
- Capacitor Android shell
- Docker deployment on the existing VPS, promoted through GitHub-hosted Actions
- Figma-first for significant tablet/mobile flows

Use `package.json`, `prisma/schema.prisma` and `docs/CURRENT_STATE.md` for exact current versions/state. Do not trust stale version numbers in old prose.

## Non-negotiable rules
- One household/auth/backend model. Do not fork tablet-specific business logic or data stores.
- Every private record must have an explicit household ownership/authorization story.
- Parent-only finance, private messages, addresses, medical notes, account controls, tokens and secrets must not appear on the shared tablet surface by default.
- Never use placeholder/fake household data in production paths. Render real canonical data, an explicit empty state, or a clearly labelled demo fixture.
- Do not add provider secrets to browser/Capacitor bundles.
- Retryable mutations require idempotency/conflict behaviour when the issue calls for offline/multi-device support.
- Do not add cron/scheduled jobs unless Cameron explicitly approves the specific scheduler. Prefer user-visible/event-driven work or an explicitly approved queue design.
- Do not copy Apple, Dribbble or competitor screens/assets. Extract principles and create original UI/graphics.
- Preserve accessibility: semantic structure, labels, visible focus, reduced motion, >=44x44 primary targets, no colour-only meaning, long-text/reflow support.
- Keep Android back, lifecycle, process-death, orientation and permission behaviour in scope for Android-facing changes.

## How to talk to Cameron

- Use simple, plain English (about grade 8 level).
- Keep answers short. No walls of text.
- When Cameron needs to decide something, give 2–4 clear choices and say which one you recommend.
- Lead with the answer or next step. Skip the background unless asked.
- Use short bullet points instead of long paragraphs.
- Explain technical terms in a few words, or skip them.
- Do the hard technical work yourself. Just say what you did and what Cameron needs to decide.
- This applies to chat replies only. Code, commits, PRs and docs keep their normal detail.

## Approval boundaries
Agents MAY analyze, design, edit code/docs, add tests, create branches/commits and open PRs.

Agents MUST NOT without Cameron's explicit approval for that exact action:
- merge a PR
- deploy or promote production/review infrastructure when it changes external state
- publish or roll out a Play Store release
- change production secrets, credentials, DNS, billing, access or permissions
- spend money or enable a paid provider
- send external messages or recruit beta participants
- destructively migrate/delete production data
- modify live user/account records

A passing build is not deployment approval. A merge approval is not production approval.

## Issue workflow
Work from one scoped issue at a time. Before coding:
1. Read parent/related issues and current source.
2. Confirm the issue has objective, dependencies, acceptance criteria and rollback/compatibility implications.
3. Inspect existing implementation before proposing a replacement.
4. Identify canonical data models/APIs; do not create duplicates casually.
5. Record assumptions in the PR.

Prefer vertical slices: UI + canonical data/API + authorization + tests + accessibility + analytics hooks where required. Avoid broad visual-only rewrites that leave old data paths competing with new ones.

## Required evidence before claiming complete
Use `docs/engineering/DEFINITION_OF_DONE.md`. At minimum for code changes, run the applicable exact commands from a clean-enough checkout and record actual results. Never claim a test/build/deploy passed unless it was run and observed.

Typical minimum gate:
```bash
npx prisma generate
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
```
Also run migration, E2E, visual, accessibility, Android and security/isolation gates when the change touches those areas.

## Responsive QA baseline
Representative sizes:
- phone: 390x844, 430x932
- portrait tablet: 800x1280
- fridge landscape: 1280x800
- large tablet: 1920x1200
- support desktop: 1366x768

Test empty/loading/error/offline/stale/success states and long text. Do not assume desktop hover.

## Design implementation
- Reuse semantic design tokens and typed component variants.
- Significant new flows should have a Figma/spec reference before large implementation.
- Delight comes from clarity, hierarchy, original graphics, immediate feedback, thoughtful motion/haptics, excellent microcopy and undo/recovery—not ornamental complexity.
- See `design/README.md`, `design/REFERENCES.md`, `BRAND.md`, issues #130–#133 and #143.

## Security and privacy
Treat household isolation as a release blocker. Direct API access must not bypass UI restrictions. Add two-household negative cases for new family-owned domains. Keep analytics/logging content-minimal. See `docs/architecture/AUTHORIZATION.md`, `SECURITY.md`, issues #102 and #136.

## Mobile/server compatibility
Installed Android clients cannot be assumed to update instantly. Avoid breaking API/schema changes without a compatibility/migration plan. Prefer expand/contract migrations and feature flags. See `docs/architecture/API_CONTRACTS.md` and `docs/architecture/ANDROID.md`.

## When blocked
Do all safe analysis/design/test preparation possible, then state the concrete blocker and next action. Do not invent credentials, external data, Figma approval, runtime evidence, user research or production results.