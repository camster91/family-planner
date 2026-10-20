# Personal inventory restart recovery — #125/#135/#473

Source foundation in progress, 2026-10-20. **Off by default, not wired into the
inventory UI, not accepted or released.** Existing mounted recovery remains the
active client path. This extends the original goal; it does not replace durable
recovery acceptance with mounted-memory behavior.

## Contract and privacy

`inventory-recovery-contract.ts` defines a strict, versioned journal of at most
20 exact normalized intake/change requests, each limited to 8 KiB, with a total
200 KiB journal cap. It contains only request kind, original key and serialized
body. No separate titles, source photos, raw OCR/model output, audio, prompts,
provider credentials or session tokens are persisted. User-reviewed stock fields
remain private household content. Unknown/future/oversized records are held,
never filtered, evicted, renewed or silently deleted. Receipt-age limits remain
server authority; local age never creates a new request.

`GET /api/inventory/recovery` authenticates a current personal account, refuses
paired context, and renews parent/teen, household, session generation and feature
authority. The private/no-store reply contains current actor/household and a
separate inventory continuity owner derived from the real session and canonical
current household/role. Stale JWT role/family claims cannot define that owner.
Legacy sessions without a nonce cannot negotiate support.

Both `INVENTORY_RECOVERY_ENABLED=1` and
`INVENTORY_RECOVERY_ROLLBACK_READY=1`, plus both existing owner-recovery gates,
are needed. None are enabled by this implementation. The public capabilities
manifest and `QUEUEABLE_ACTIONS` stay unchanged. This is explicit recovery of
previously reviewed online requests, not background offline stock mutation.

## Storage and authority

`inventory-recovery-store.ts` accepts browser storage candidates and fresh
negotiation from its caller. It uses the existing owned v2 envelope and shared
retirement/lease primitives. The inventory-specific owner scope gives it a
separate key in the existing owned-person database; it cannot replace a grocery
journal. Generic captured-scope, revoked-generation and confirmed-household
retirement recognize the outer owner, including unloaded inventory records.
Unknown records are left untouched. No independent logout purge is introduced.

All reads/writes/sends are serialized and hold a non-waiting owner Web Lock.
Missing/contended locks pause. Every physical candidate must be readable; copies
must agree. A successful write requires one verified copy and verified removal
of every other copy. The exact proposed transition is captured before writes.
Uncertain cleanup/write keeps that intent; explicit recovery can repair only its
known baseline/attempted/cleaned copies. Unexpected new bytes or retirement
witnesses cannot be overwritten. Total failure of all retirement witnesses still
requires fresh owner negotiation and explicit review after runtime replacement;
saved bytes alone are never proof of live authority.

Every recovered row requires deliberate review and a caller-supplied canonical
target/receipt check before a send. The store has no timer, automatic drain or
endpoint guessing. Sender receives the original kind/body/key and inventory
owner proof; completion does not automatically erase the journal. Confirmed
completion or explicitly confirmed local dismissal must persist removal. A
storage failure cannot be reported as successful dismissal.

The intake/change routes enforce an optional supplied
`X-Herewoven-Inventory-Owner` proof before body processing/idempotent replay,
even while new recovery writing is paused. Missing header preserves old clients.
Authority still comes from the existing live session and canonical transaction
checks. Post helpers accept the captured scope without rewriting the body/key.
Rollback must retain proof checks, negotiation, readable journals and canonical
receipt semantics. Turning a flag off does not authorize dropping saved work or
falling back to unbound legacy writes.

## Remaining implementation and consolidated acceptance

### Canonical review and browser bridge source — 2026-10-20

`POST /api/inventory/recovery/review` now reviews one strict original entry with
required inventory owner proof, common paired-first auth and renewed canonical
parent/teen inventory authority. Body limit is 32 KiB (including escaped original
body), rate cap 60/user/minute, and every outcome is private/no-store. It reads
receipts/stock/adjustments/ingredient ownership inside the canonical authority
transaction; it writes no stock, receipt or product.

The response echoes the exact entry and owner scope. A receipt must match
original key, action, request hash, user and household. Successful proofs yield
current owned stock or explicit original removal; removal operations need their
matching completed receipt. Unknown/contradictory proof stays unavailable. With
no receipt, issued-at bounds prevent recreating an old operation after receipt
pruning. Existing pending work is held. Current stock/version and Undo ownership
are checked; missing and foreign targets are indistinguishable. `ready` is only
a review snapshot, never a guarantee that a later write will succeed.

`inventory-recovery-client.ts` bounds negotiation/review to ten seconds and
32 KiB streamed responses (post-parse bound on JSON-only old bridges), including
fetch implementations ignoring cancellation. It rejects mismatched owner,
kind/key/body and contradictory state/receipt metadata. Browser adapters bind
the controller to the original person/household and existing owned-person
storage candidates. Checked inspection revalidates owner and physical storage
after the canonical read. No automatic retry or native capability is added.

Test source covers receipt expiry/pending/hash/household, canonical versions and
removal proof, private authority refusal, bounded fetch and response binding.
These tests have not run. Main forms/capture/stock wiring and EN/ES recovery
controls remain implementation work; support stays off.

- Wire bounded negotiation, storage candidates and lifecycle into personal
  inventory; fail closed before new writes when an existing journal is unknown
  or support is paused. Connect forms, barcode/photo saves and stock actions to
  durable stage-before-send and confirmed dismissal. Keep manual draft fallback
  truthful when storage is unavailable.
- Implement a bounded canonical recovered-target/receipt reviewer and EN/ES
  review, retained/expired/removed, retry, confirmed-dismiss and uncertain-storage
  controls. Reconstruct no lost keys or rewritten bodies. Preserve navigation
  guards until both request outcome and local transition are resolved.
- Exercise two-household/role/session/direct API negatives, current/previous and
  forward/rollback candidates, lost acknowledgements, partial writes, divergent
  copies, failed retirement, cross-tab races, capacity and quota, offline/restart,
  app update and physical WebView process death. Source tests are authored only.
- Signing, physical devices, store distribution, provider eligibility/activation
  and production rollout remain separate dependencies. No schema operation,
  native compile, permission request or real household mutation occurred here.
