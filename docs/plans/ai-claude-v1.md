# App-held AI with Claude — v1 (#144)

Owner decision, 2026-11-19 (Cameron), recorded after the review that found
Google's Gemini API terms restrict apps likely to be used by under-18s.
Source only: nothing here is switched on, deployed or measured against the real
model. Gemini stays blocked (`geminiProviderApproved()` is a source-level `false`).

## Decisions

- **Provider:** Anthropic Claude, called from our server with **one app-held
  key**: the Worker secret `FAMILY_AI_ANTHROPIC_API_KEY` (same
  `<SCOPE>_ANTHROPIC_API_KEY` pattern as `EVENT_IMPORT_ANTHROPIC_API_KEY` and
  `INVENTORY_SCAN_ANTHROPIC_API_KEY`). Never in browser or Capacitor bundles.
- **Model:** `claude-haiku-5-5` for extraction/drafting, structured output
  (`output_config.format` JSON schema), validated again with zod on our server.
- **Swappable:** features call a provider-neutral interface
  (`src/lib/ai/provider.ts`); Claude is the only implementation. A Gemini
  adapter stub exists and always refuses.
- **Who:** parents and teens (same rule as AI capture, `canUseCapture`).
  Children never. Paired/shared tablet sessions never (refused by
  authentication; launcher hidden on device/fridge surfaces).
- **Opt-in:** a parent-only household switch "Smart helpers (AI)" in Settings,
  **off by default**.
- **Budget:** per-household monthly cap, default **$2**, metered in the
  existing content-free `AiUsageRequest` ledger. Reserve before the call,
  settle reported usage after. Existing household AI pause and daily limits
  (`AiUsagePolicy`) also apply.

## Flags (all must be on; any one off = no AI)

| Gate | On when | Default in `wrangler.jsonc` |
| --- | --- | --- |
| `FAMILY_CLAUDE_AI_READY` | exactly `"1"` | `"0"` (unset is also off) |
| `FAMILY_AI_PROVIDER_DISABLED` | global kill switch, `"1"` pauses | absent |
| `FAMILY_AI_USAGE_READY` + `FAMILY_AI_USAGE_ROLLBACK_READY` | both `"1"` (meter) | `"1"` (existing) |
| `FAMILY_AI_ANTHROPIC_API_KEY` | Worker secret present | not set |
| Household switch | parent turned it on | off (no row) |

## Guardrails

1. **AI proposes, a person confirms.** Providers only return draft rows. Each
   row saves through the existing canonical create route with its own
   `Idempotency-Key`; nothing is written by the AI route except the
   content-free usage reservation.
2. **Data minimization.** Sent: the typed text, the viewer's local date/time
   and time zone, placeholders for household people, grocery list names.
   Every household member's name (in the text and in list names) is replaced
   on our server with "Person A", "Person B" … and mapped back afterwards. No
   ids, colours, ages, photos of children, medical, finance or private
   messages. Feature data classes are declared in `src/lib/ai/registry.ts`.
3. **Untrusted output.** The note is fenced as data; the schema allows only
   four row kinds and no actions; zod refuses extra keys; text is cleaned;
   dates outside today −1 … +366 days are dropped; invented placeholders are
   dropped and the row is flagged "check who".
4. **Bounded calls.** Single attempt (SDK retries off), 20 s timeout,
   64 KiB response cap, provider error bodies dropped unread, fixed host,
   no redirects. Logs carry status codes only.
5. **Household isolation.** People and lists are read for the caller's own
   household only; the reservation SQL re-checks household, role and session
   generation; the reply is re-authorized before it is returned.
6. **No schedulers.** Everything is person-initiated.
7. **Expand-only storage.** D1 `0024_household_ai_setting.sql` and PostgreSQL
   `migration-zzzzzzzzzzzzzzzzzzz-household-ai-setting.sql` add the
   `HouseholdAiSetting` side table and (PostgreSQL) widen the
   `AiUsageRequest.job` check to include `smart_add`.

## Phased plan

**Phase 1 — household helpers (this branch starts it)**
- Smart Add (built): one text field at the top of "Add or ask" → reviewed
  drafts for events, chores, grocery items and meals; Add all, per-row edit and
  remove, Undo for parents. Offline/AI-off falls back to the local comma split
  for grocery items.
- Snap a flyer: move event import (#270) onto the shared service and key.
- Smart grocery add: list-aware splitting/quantities on the list page.
- Dinner ideas: suggestions from saved recipes and stock, reviewed before
  planning (reuse grounded food planning).
- Assistant with Today: answers grounded in the Today context, same aliasing.

**Phase 2 — web search with sources.** Claude web search with visible
sources, allow-listed domains, parent-only at first; per-search cost in the
meter.

**Phase 3 — planning.** Multi-step weekly planning proposals (meals, chores,
schedule conflicts), always as a reviewable plan, never auto-applied.

## To switch it on (owner actions, not done here)

1. Add the Worker secret `FAMILY_AI_ANTHROPIC_API_KEY` (Anthropic Console key,
   with a workspace spend limit).
2. Apply D1 migration `0024_household_ai_setting.sql` (and the PostgreSQL file
   where that path is used).
3. Set `FAMILY_CLAUDE_AI_READY` to `"1"` in `wrangler.jsonc` in a reviewed PR
   and deploy.
4. A parent opens Settings → "Smart helpers (AI)" and turns it on.
5. Run the reviewed-provider QA in `docs/testing/AI_EVALUATION.md` against the
   real model before announcing it.
