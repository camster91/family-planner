# Query and plan documentation reconciliation (#134 / #377)

This documentation-only follow-up corrects source query bounds, fills the actual local production-build
baseline and consolidates repeated execution snapshots. It does not close any original #134 requirement
or declare the remaining48 issues complete. No application/API/schema/config/workflow/native change is made.

## Source and preservation

Accepted prerequisite #422 merged normally as73805fe9e94048bddcb993a5ab49509ee28a90af after its original
hosted checks:899 journeys/28 visuals, Build/Test, checked-image security, GitGuardian and resolved threads.
All five original #421 criteria are checked/closed; only its accepted owned branch was removed. Publish/VPS
skipped. The unavailable cloud review is not represented as a passed review.

Five plan entry points retain their entire original contract/checklist/matrix tails byte-for-byte. Their dated
refresh prefixes are preserved verbatim in labelled archive source blocks with source-context links and hashes.
The original full documents reconstruct exactly from those two preserved parts. All51 original issue-body
sections in the matrix remain intact. Named full backups and per-part SHA256 records precede the consolidation.
CURRENT_STATE.md now holds one current summary; the other entry points link to it and live #377/issue/PR records.

Source review corrects two observability claims: legacy chores cap at500 and current parent-page queries at500
each; a meal date window is not a row bound because multiple meals may share a day/type. Lists, deprecated
list-items/current list details and meal reads need compatible cardinality/paging review. Some related calls
are already bounded; source limits are not substituted for complete N+1/SQL, high-cardinality or capacity proof.
The raw AST callsite inventory labels20 fixture-seed calls separately from207 other source sites requiring
runtime/domain classification. It does not assert176 queries are unbounded or establish all raw SQL/relations.

## Measurements actually observed

The existing compiled6a09e04 production build reports builtAt2026-10-09T02:57:55.778Z. Its app/build inputs
match accepted #422 and this documentation branch; no new local build is claimed. The unchanged guarded
performance script completed300 timed requests (30 per ten endpoints after3 warm-ups), all200, sequential
on loopback. Host, January fixture clock, small cardinalities and exact table are recorded in
[PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md). Route/query logging and expanded-copy flags were off;
owned server and database were stopped. It is not production SLO, SQL-count, realistic load, concurrency,
physical-device, inventory/AI or household-beta evidence. The1003-image gallery is unchanged.

## Validation and rollback

Preservation SHA/reconstruction and51-section assertions, new active relative links, git diff whitespace,
repository format and type checks pass. App/dependency/config/test/native/workflow inputs are unchanged from
accepted main; no new mirrored tests or repeated local build/browser run is needed for prose/archival moves.
Original hosted gates, exact-candidate review, secret tree/history scans and normal protected merge must still
be observed on the published documentation candidate before describing it as merged.

Revert this documentation-only commit to restore the earlier layout; archive/backups retain all prior text.
There is no database/API/installed-client or production migration/rollback. Original owner/provider/native,
research/real-household acceptance and broader parent scopes remain open.
