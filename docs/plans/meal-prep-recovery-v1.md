# Durable canonical bulk editor/action recovery — #123/#144/#128

2026-10-22: strict contracts, canonical apply/inspection endpoints and browser
journal adapters are source-authored. Forms/discovery/restore UI are not wired.
Cases are authored and unrun. Nothing in this checkpoint is release acceptance.

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

## Remaining source work

1. Wire one panel-owned controller into existing `useMealPrepMutation`, creation
   editor and action sheets; do not mount competing journals for one editable
   document. Debounce raw fields, flush on close/navigation and promote the exact
   editable predecessor atomically before sending. Preserve exact requests when
   promotion/storage/receipt outcomes are uncertain.
2. Add canonical personal recovery discovery, editable restore and compact
   pending/inspect/exact-retry/known-result/acknowledged-forget/repair controls.
   Restoring an action must reload its exact canonical session/batch first.
   Missing targets may block editing but cannot erase an unresolved request.
   Keep dialogs mounted through reload failures; current source state must block
   fresh writes without destroying pending recovery.
3. Preserve existing new-request behavior/installed-client compatibility while
   the readiness gate is off. Once an owned journal has been adopted, pausing
   readiness must retain explicit inspection/recovery, with no silent legacy
   fallback. Do not activate the new path until its full applicable QA passes.
4. Connect prepared-dish handoff and wider inbox/weekly discovery, and reconcile
   the source/acceptance ledger and open issues. Prepared reuse is not complete
   merely because the navigation intent is implemented.

## Deferred acceptance and rollout

`FAMILY_MEAL_PREP_RECOVERY_READY=0` is documented only; no actual settings changed.
No migration is required by this checkpoint. Source/mock/storage-fault cases and
an allowed disposable-PostgreSQL rollback/replay case are authored and **unrun**.
Run consolidated unit/API/DB/concurrency/role/generation/compatibility/storage/
process-death/browser/accessibility/device/release checks after all source work.
Keep native/store/physical-device acceptance separate. No flag, provider, CI,
push, merge, deployment or issue closure is established by authored source.
