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
- `owned-queue-persistence.ts`: owned journals now live in `fp-owned-person`
  and `fp-owned-device`, with kind/scope-qualified localStorage keys. Legacy
  namespace/database deletion cannot erase a replacement journal. Captured
  scope retirement, server-revoked generation cutoffs and confirmed household
  erasure recheck each current record and its derived key before replacing only
  matching old data with a retirement witness. Unknown future records remain
  untouched; a cleanup result covers classified matching records, not proof
  that every possible local trace was erased.
- Non-waiting exclusive Web Locks cover owned journal reads, writes, retirement
  and the checked send. The in-page persistence lane remains separate. Missing
  or contended locking pauses rather than assuming cross-context exclusion.
  Exact write/retirement intent is captured **before** lease acquisition, so a
  failed lease cannot make explicit recovery load an older snapshot in its
  place. An in-flight terminal device request gives its own pending retirement
  one event-driven attempt after its send lease is released; no retry timer.
- Sign-out uses an atomic `token_version` compare-and-increment. Its private
  receipt retires only that account's generations at/below the revoked cutoff,
  including unloaded journals. A late cleanup cannot target a later generation
  or another account. Confirmed account/household deletion supplies a bounded
  private retirement receipt for the erased actor and, when applicable, the
  erased household fingerprint across person/device journals. The deletion UI
  attempts bounded local cleanup before its redirect/callback; absent lost-ack
  receipts do not authorize guessed deletion of unclassified records.
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
- `queue-review-contract.ts`, `queue-review-server.ts` and the two private
  `queue/review` routes resolve current canonical names for at most 50 targets.
  Requests contain only target/actor IDs and desired tick state, never saved
  food text. Feature, household, namespace, device-write and real-account
  subject boundaries are retained; missing/foreign targets return the same
  null descriptor. Bodies are stream-bounded, rate limited and no-store.
- `RecoveredQueueChanges` supplies EN/ES short review/discard sheets for both
  personal lists and shared tablets. It validates the response owner and every
  operation fingerprint before showing canonical names or enabling retry.
  Saved add text is hidden until its current target list is validated. Tick
  review shows the actual item/list, original member and desired/current state;
  unavailable targets stay kept without retry. Local discard requires explicit
  confirmation and no success is claimed after uncertain persistence. Old
  personal recovery remains available for the inactive v1 mode. Copy changes
  do not refetch names or replace an operation.

`QUEUE_OWNER_RECOVERY_ENABLED=1` **and**
`QUEUE_OWNER_RECOVERY_ROLLBACK_READY=1` are required. Neither was set. A negative
negotiation preserves the v1 adapter but probes the current owned namespace and
pauses if newer owned work is present or cannot be read. Once adopted, the
rollback-ready boundary continues requiring owner proof on keyed queued routes
even when new writing is paused: turning only the write flag off cannot silently
allow old queued requests. Keep the adopted reader/proof boundary through a
rollback; do not reset it while owned work remains. An unavailable negotiation
pauses rather than guessing support. Cold-offline startup behavior therefore
still needs the complete native/bootstrap integration, not an availability
claim from these sources alone.

## Explicit legacy bridge source

`legacy-queue-migration.ts` and the EN/ES `LegacyQueueRecovery` sheet now
provide an explicit bridge for fully recognized v1 snapshots. Canonical target
and actor IDs are checked before showing saved food text. Every recognized row
requires Keep for review or explicit Discard; Leave keeps the source untouched.
Unknown fields, unread copies, divergent snapshots and missing current targets
cannot be guessed into a new queue. The existing 50-item capacity never evicts
an existing item to make room.

The bridge holds a legacy namespace lease followed by the current owner lease,
rechecks ownership, copies the original keys/bodies/timestamps into verified
owned storage, and only then retires the old copies. Uncertain copying locks the
exact decision for explicit retry; it does not authorize a different merge or
an overwrite of unfamiliar new work. A context change after copying preserves
the old source. Copied work is held for individual review without automatic
network replay. Legacy device creates stay locked as
`ORIGINAL_DEVICE_REQUIRED`: the unknown original pairing's idempotency scope
cannot safely be rebound. People must inspect the canonical list before making
a separate new add.

Persistent review IDs also retain recovered failed records beyond the normal
failure retention period until deliberate review/discard. Recognized legacy
retirement witnesses are readable when the write gate is off; an active newer
journal still pauses the older writer. The adopted server proof boundary must
remain enabled through rollback. Unknown/future records remain untouched.

Focused fault-test source now covers original intent retention, lost write
acknowledgements and exact-decision retry, changed owners before and after copy,
unread/divergent old copies, unknown payload fields, unsafe tablet creates and
recovered failure retention. These tests have **not run**. Actual Web Locks,
previous-client compatibility, native lifecycle and the full acceptance matrix
below remain for the consolidated QA pass. No minimum-client/public capability
claim or rollout opt-in has been changed.

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
