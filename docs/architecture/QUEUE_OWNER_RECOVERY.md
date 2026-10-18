# Queue ownership and retirement — #564 source in progress

Status: **implementation in progress, off by default**. This is not completed
queue recovery, QA evidence, migration acceptance or activation approval.
Cameron requested source/plans first and one integrated QA pass afterward.
No QA, hosted run, migration or live account/device change is part of this pass.

## Why a local blocked flag is insufficient

The existing v1 adapter can remember an uncertain purge only within its current
JavaScript runtime. If a failed deletion leaves one old copy, a new runtime has
no evidence that deletion was attempted. Another in-memory flag or selecting a
preferred store cannot prove that the surviving work is live. If every attempt
to write a retirement witness failed, pure local bytes are indistinguishable
from the pre-retirement snapshot.

The new candidate therefore combines canonical owner continuity, a durable
retirement journal and **explicit review after runtime replacement**. It does
not claim that a hash or a surviving snapshot proves absence of a failed purge.

## Current source

- `queue-owner-contract.ts`: strict private owner-response and v2 storage
  envelope; a positive `v: 2` lets compatible old queue readers quarantine it.
  The inner container, four action schemas, request keys and bodies stay v1.
- `queue-owner-server.ts`: current person-session/household/role/generation
  continuity and stable device-pairing/household continuity. Person proofs hash
  the actual session token plus resolved current context; no raw token is
  returned. Device proof survives normal access-token refresh, but changes with
  pairing identity/household. These are continuity identifiers, never authority.
- `auth.ts`: optional `sid` nonce is fresh on every token issuance. Existing
  token-version, signature, expiry and database role/household checks remain.
  This distinguishes two sign-ins even in the same JWT timestamp second.
- `/api/queue/owner` and `/api/device/queue-owner`: authenticated private/no-store
  negotiation. Person routes refuse paired context before personal cookies;
  the device route retains the shared-device kill switch and device client
  refresh/revocation behavior. Failed/unknown negotiation never grants support.
- `queue-owner-store.ts`: compares all physical copies, refuses unread or
  divergent storage, validates saved owner context and preserves unknown
  formats. Writes try current then all other candidates once, including earlier
  recovered stores. One verified journal remains only after all other copies
  are removed and read back empty. Uncertain writes/cleanup pause the queue.
- In-memory exact write intent survives explicit read recovery: the adapter
  repairs only its known prior/attempted copies. It never replaces a newly
  queued operation with an older saved snapshot after a failed write. Unknown
  third-party copies stop recovery. Requested retirement is retried explicitly
  as retirement, never reloaded as active work. A verified last retirement
  witness is retained instead of deleting all evidence.
- A recovered active journal from another runtime becomes per-item
  `QUEUE_REVIEW_REQUIRED` conflict state. It never auto-drains. Request keys,
  payloads and timestamps are retained. Those review states are not aged away
  before they are seen. Grocery adds keep the existing unsafe-old-create retry
  restriction; no request is renewed to evade dedupe retention.
- Before every send the adapter checks fresh canonical owner context, current
  physical journal and the complete original method/path/body/key. The captured
  owner scope travels in `X-Queue-Owner`. The two person and two device
  queueable write routes compare it with the actual request's authenticated
  context **before** idempotent replay or mutation. With the gate on, missing
  old-client proof is a recoverable 409, not successful legacy replay.
- Browser wiring, EN/ES grocery/list recovery copy and per-item personal
  controls recognize the new states. The generic unnamed tick overview directs
  recovered ticks to their actual list for review instead of allowing blind
  retry by an index. Device failure handling retains ownership/storage-uncertain
  actions rather than silently discarding them.

`QUEUE_OWNER_RECOVERY_ENABLED=1` **and**
`QUEUE_OWNER_RECOVERY_ROLLBACK_READY=1` are required. Neither was set. A negative
negotiation uses the existing v1 fallback adapter; an unavailable negotiation
pauses rather than guessing support. Cold-offline startup behavior therefore
still needs the complete native/bootstrap integration, not an availability
claim from these sources alone.

## Required coding before freezing the candidate

These are remaining implementation work, not requests for Cameron to unblock:

1. **Principal-qualified persistence and cleanup.** The current browser
   candidate still wraps the existing physical namespace. Move owned journals
   into principal/generation-qualified storage, and make lifecycle cleanup
   retire only captured old keys. Existing broad `clearPersonQueues` database
   deletion and the device wipe must not race a replacement into deleting new
   work. Enumerate/snapshot owned cleanup safely, preserve witnesses on failure
   and cover unloaded stores. Do not enable the gate while this is incomplete.
2. **Cross-runtime serialization.** The existing persistence lane orders
   in-page wrappers; read/compare/write is not an atomic cross-tab lease.
   Integrate an actual browser/native ownership lease or equivalent canonical
   exclusion before granting concurrent journal mutations. Unsupported or
   unavailable lease capability must remain an explicit paused state, not an
   assumed lock. Keep exact-operation recovery and no retry spin.
3. **Legacy and rollback recovery.** An unowned v1 snapshot is currently
   retained as `UPDATE_REQUIRED`, not silently adopted. Implement deliberate
   migration/review using canonical current-household target checks before
   displaying or replaying its content. Preserve original keys/bodies and
   unavailable/foreign-target work without exposing old-household details.
   Finish reader continuity when the write opt-in is turned off and confirm
   the actual previous-client preservation contract before any v2 persistence
   is allowed in release. Do not just change the public manifest to claim it.
4. **Shared-tablet recovered tick controls.** Grocery-add review is visible,
   but recovered tablet ticks still need a named canonical-item review surface
   that respects paired read/write permission, selected real account subject,
   feature gates and missing/foreign targets. Do not auto-convert account IDs
   to profile IDs or add a profile action to the queue allowlist.
5. Finish scoped fault/concurrency test source and then include it in the one
   later QA run. No check is currently claimed passing.

## Consolidated acceptance after source completion

- Two isolated households/accounts and two pairing identities; current and
  legacy sessions, sign-in nonce, password/session generation, role and family
  changes, paired plus lingering person cookie, access refresh, replacement,
  revocation and shared-device/write kill switches.
- Failed retirement with sole stale copy, all write failures, unread witness,
  divergent copies, delayed writes, process death, replacement-instance and
  cross-tab races, purge deadlines, previous/next reader rollback and update.
- Exact-operation recovery after both total and partial writes; no lost
  in-memory add/tick, no renewed request ID/body, no replay before owner proof
  and deliberate review, no blind cleanup/merge/overwrite and no retry spin.
- Stable canonical item/list ownership, current permissions, idempotency replay
  guarded before returning saved success and no duplicate grocery creation.
- EN/ES, keyboard/Back, all pending/error/unknown/retired/review states, named
  tablet tick recovery, disabled unsafe retry, storage quota/blocked IDB,
  cold/offline/reconnect and meaningful exact candidate artifact provenance.
- No proof/session token, owner hash, payload or private subject in diagnostics,
  logs, public capabilities or shared error text. Hashes are private continuity
  metadata only and do not bypass the actual action authorization.

#564 stays open. #565's earlier-candidate retry was already present in
`391844c9` and is a separate source reconciliation, not proof that this durable
retirement domain is complete.
