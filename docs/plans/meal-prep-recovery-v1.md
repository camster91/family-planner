# Durable canonical bulk editor/action recovery — #123/#144/#128

2026-10-22: strict contracts, canonical apply/inspection endpoints, browser
journal adapters, one panel-owned controller and existing creation/action form
bindings plus personal restore/recovery controls are source-authored. Read-only
parent inbox discovery and personal weekly navigation are also authored. Wider
chat/provider coordination and acceptance remain. Cases are authored and unrun.
Nothing in this checkpoint is release acceptance.

## Canonical scope and identities

Reuse the existing create/prepared/allocate/eaten/undo-eaten/next-prep models and
`persistMealPrepInTx`; do not introduce a second stock or portion domain. A frozen
request contains the original canonical command, original parent/teen role, token
generation and issued instant. Actor/household context must match both outside
and inside the effect transaction. A person-only domain-hashed existing queue
owner scopes the journal. Paired devices are refused. Profiles are not accounts.
No provider call, credential, private layout-seeded owner or background replay.

## Source implementation

- `src/lib/meal-prep-recovery/contract.ts`: strict context/frozen request/exact
  action receipt and receipt-first state DTOs. Expected success status, unique
  IDs, created meal counts and existing target IDs must match the frozen action.
- `draft-contract.ts`: raw incomplete create/action fields remain local-only;
  local drafts cannot parse as network input. One editable document plus at most
  four frozen requests share the existing bounded owned CAS journal.
- `owner.ts`: independent readiness plus existing owner recovery/rollback gates.
  Scope hashes contain no raw token; no secrets enter journals or API responses.
- `server.ts`: original authority, exact root scope/action/hash and bounded
  canonical receipt proof. Apply reserves through normal idempotency and composes
  the canonical effect/receipt in an authorized Serializable transaction. Any
  canonical failure throws so intermediate rows roll back. Readiness and lease
  are rechecked before commit. Matching completed replay does not renew a lease,
  depend on deleted targets or create another effect.
- `http.ts`: bounded no-store person context/inspect/apply endpoints under
  `/api/meals/bulk/recovery/`. Apply requires identical header/body request keys;
  a local draft cannot dispatch. Legacy canonical routes remain compatible.
- `client.ts` / `browser.ts`: strict foreground requests, current owner renewal,
  exact key/body/hash reply binding and existing owned storage/retirement leases.
  Every send requires explicit inspection eligibility, even same-screen retries.

Inspection authenticates the original current role/generation, reads matching
receipts first and never mutates targets. Missing/pending/paused/expired/conflict
states do not establish that a previous save failed. New attempts stop24 hours
from the original issued instant (shorter than the canonical seven-day receipt
retention); inspected exact retry stays bounded by that original deadline. A
completed matching receipt remains readable after expiry/pause. Nonmatching or
lost save replies remain unknown, preserving the same key/body. No fallback to a
new key or unowned write after adoption/storage failure is permitted.

## Form and recovery source checkpoint

`src/components/meals/recovery/useBulkRecovery.ts` owns one journal per canonical
bulk panel. `BulkRecoveryContext.tsx` gives existing create/action forms their
latest raw reader and delegates saves through `useMealPrepMutation`. Strict
`draft-input.ts` conversion must match both the actual submission and unchanged
raw/local predecessor before promotion. Opening/restoring never submits. Failed
promotion cannot dispatch; exact repair can expose the frozen original without
sending it. Matching success remains known after subsequent read failures.

`BulkRecoveryShelf.tsx` provides bounded personal draft/request discovery and
explicit inspect/retry/repair/acknowledged-forget/stored-copy reload controls.
Stored-copy reload cannot replace an uncertain transition; repair comes first.
Back dismisses its acknowledgement before the underlying form. Closing owned
forms retains drafts/requests; confirmed forms remain readonly until Close.
Personal recovery/forms are omitted in fridge mode and while the event preparation
sheet owns the view; no private owner is seeded in layout. Action restore refreshes
the exact same session/batch/consumption and complete portion metadata. Missing targets never erase unresolved requests or substitute
another dish. Prepared reuse waits for recovery/draft ownership to settle.

Existing empty owned envelopes remain evidence of adoption during a pause; the
new path does not silently downgrade an adopted journal to unowned legacy writes.
Legacy flag-off/no-envelope journeys and installed public canonical clients remain
compatible. Owner/generation failures suppress private state without deleting old
storage. Storage races retain newer dirty fields and block navigation until the
current reader is durable; exact requests retain keys/bodies through reload.
Raw restoration/ownership/Strict Mode and all actual lifecycle behavior still
require consolidated acceptance, not an inference from authored cases.

## Remaining source and acceptance

1. Parent inbox draft/frozen-request snapshots and personal weekly discovery links
   are source-authored. Complete their actual cross-store/role/lifecycle/rendered
   acceptance. The explicit recovery URL can inspect receipts without a successful
   current-list read; editable target restoration remains canonical. Keep local
   journals out of shared/profile views.
2. Finish the broader approved food/inbox/weekly/chat/provider/evaluation work in
   `grounded-food-planning-v1.md` and the full thread objective, then reconcile
   issue/source states before consolidated QA. These controls do not complete the
   wider programme or native/store/physical-device deliverables.
3. Run all applicable consolidated correctness, privacy, storage, history/focus,
   restart, stale/permission, compatibility, PostgreSQL/concurrency and rendered
   responsive/EN/ES/accessibility/release checks, then fix failures and complete
   authorized merge/deployment. Keep source completion and acceptance distinct.

## Deferred acceptance and rollout

`FAMILY_MEAL_PREP_RECOVERY_READY=0` is documented only; no actual settings changed.
No migration is required by this checkpoint. Source/mock/storage-fault cases and
an allowed disposable-PostgreSQL rollback/replay case are authored and **unrun**.
Run consolidated unit/API/DB/concurrency/role/generation/compatibility/storage/
process-death/browser/accessibility/device/release checks after all source work.
Keep native/store/physical-device acceptance separate. No flag, provider, CI,
push, merge, deployment or issue closure is established by authored source.
