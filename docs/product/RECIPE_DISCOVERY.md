# Recipe discovery (#460)

## Reference and flow
Paprika documents browser search, clipping into a recipe box, categories and meal planning (https://www.paprikaapp.com/help/windows/). Samsung Food documents discovery, saving from websites and a reusable recipe box (https://support.samsungfood.com/hc/en-us/articles/18365507924372-Getting-Started-with-Samsung-Food-Save-Search-and-Share-Recipes).

Meals exposes Explore recipes. Search selects a fixed publisher (BBC Good Food, Allrecipes, Serious Eats) and retrieves up to 24 same-publisher recipe titles/links (six shown at a time with Show more) inside the app, with public source search shortcuts as a fallback. Publisher markup can change or block fetching; empty/unavailable results are explained without implying comprehensive coverage. Copy a public recipe URL to preview supported Recipe JSON-LD in a plain React reader. Optional original-page viewing uses a sandboxed iframe without same-origin, forms, top navigation or popups; Open original is always available because framing can be blocked. The app does not execute extracted page HTML, bypass login/paywalls or promise all websites work.

Parent/teen review the imported draft with the existing RecipeEditor, then save to canonical household Recipe records. Source attribution is visibly stored in description, not a new model; saved detail renders a safe original-source link. Ingredients preserve authored quantity text inside directions; structured ingredient rows require human review before grocery generation, never guessed conversions. Existing save uncertainty/pending guards remain. A recipe source already in the loaded library offers Open saved. The paginated household box filters loaded titles/descriptions and exposes Load more; no invisible global search claim. Named collections/favourites are not implemented in this slice. Search is one chosen publisher at a time, not a licensed comprehensive web index.

## Transport and boundaries
POST /api/recipes/discover authenticates/gates/throttles and permits only the fixed source identifiers with a 2–120 character encoded query. It returns recipe titles/links, no publisher body excerpts. POST /api/recipes/preview authenticates household, checks meals feature, parent/teen role and 15/minute per-user throttle. Existing feed transport is reused with optional HTML Accept and recipe User-Agent; calendar defaults unchanged. Public-DNS pinning, redirect checks, HTTPS credential/private-address refusal, 10-second timeout and 2MiB response cap apply. No cookies/credentials sent to publishers; no saved data written by preview. JSON-LD traversal/text lengths capped. Errors preserve original-link fallback. Recipe API remains unchanged, including household isolation.

TheMealDB was evaluated but not activated: its test key is for development/education and public app-store release requires supporter membership (https://www.themealdb.com/api.php). No paid provider or new credentials.

Local checks and static mounted previews are not release, physical-device or authenticated production proof. Rollback removes Explore entry/new route/preview parser and optional initialDraft editor prop.

## Full saved search and exact-create recovery source — 2026-10-18

The next #460 candidate replaces loaded-page filtering with canonical server
search over all household recipes. Saved-library query is separate from online
publisher query. Filters include title/description, a reviewed ingredient-name
substring, maximum known prep minutes and minimum base servings. Null prep time
is excluded with a limit; raw imported ingredient lines are not guessed into
structured ingredient matches. Limits and strings are validated before querying,
all clauses retain the household predicate, and matching pages keep title/ID
order. EN/ES controls use a short collapsed advanced section. Provider absence
does not affect saved search. Collections/favorites are still remaining work.

New RecipeEditor creates send an explicit
`creation_protocol: herewoven.recipe-create.v1` body marker plus a stable key.
The current strict schema accepts only this known marker and the route requires
a key for it. Prior strict readers reject the new body before creating records;
a retry must not silently enter a key-ignorant old create route during rollback.
Legacy unmarked callers remain supported, with no promise that an old client's
unkeyed create gains exact retry safety. This does not add creation to the
offline action allowlist or advertise a new native/member protocol.

`recipe-write.ts` takes User then household then receipt locks, rechecks current
account/session generation, family, parent/teen role and meals eligibility, and
commits Recipe + resolved RecipeIngredient rows + the receipt atomically. The
receipt contains only the stable recipe ID, avoiding the generic receipt size
cap for long directions. Completed responses hydrate current canonical detail
under renewed authority with sequential flat reads and a recipe shared-row lock.
No cached old recipe content is replayed across a role/family/generation change;
a subsequently deleted recipe returns an unavailable conflict, never recreation.

The editor retains the exact create key/body in memory after uncertain outcomes,
locks its fields and offers **Check the same save**. Explicit retry sends that
same tagged body/key, never renews them, and stops after a bounded 24-hour window
or a backward clock jump. A 30-second transport timeout is uncertain, not proof
of failure. Closing loses that in-memory recovery handle and directs the user
to inspect the recipe box before any separate new create. PATCH uncertainty
retains its prior no-blind-retry policy; optimistic edit revisions remain a
separate follow-up before stronger concurrent-edit claims.

Focused unexecuted test source covers concurrent transactional creates, long
methods/small receipts, receipt-failure rollback, deletion after response loss,
revoked generations, same-body/key UI retry and search scope/filter rejection.
No tests, native/web builds, type/lint checks, browser QA, migration, provider
call, push, merge or deployment occurred. Later consolidated QA must also
exercise old strict-server refusal, two-household direct negatives, pagination
and search races, EN/ES, post-commit detail failure and all original journeys.

Remaining #460 code: durable source/deduplication and explicit copy/update
choices, favorite/collection curation, broader discovery constraints, portion
variation and cooked-history policy reconciliation. Optional model parsing
remains governed by #567's unresolved provider eligibility/privacy decision.

## Source identity, favorites and named collections candidate — 2026-10-18

This local #460 follow-up implements the requested curation code. The additive
`migration-recipes-curation.sql` adds original-source URL/key, household favorite
and recipe revision, plus `RecipeCollection` and `RecipeCollectionEntry`.
Composite household FKs prevent foreign recipe/collection memberships even if
an application caller is wrong. The migration, generated client and all QA are
**not run** in this implementation-first pass.

### Duplicate and edit behavior

Source identity normalizes HTTPS URLs, fragments, tracking parameters and query
ordering without merging different path case or recipe-specific query values.
New imports retain durable source provenance separately from editable family
description/method. Same-source creation is checked under the household lock;
it returns the existing same-household recipe rather than overwriting it.
Old description-only imports are recognized by the exact supported Source
prefix and the same normalizer. More than 2,000 unclassified older imports stop
the default check if no match was found; they do not establish absence. No
network request or speculative database backfill occurs during this lookup.

The reader and editor offer Open saved (including its normal Edit path) or a
visible, deliberate separate-copy choice. The copy is another canonical Recipe
with a new identity and the same original provenance; it is never a background
reimport or an automatic replacement. Manual recipes sharing a title are not
merged: a title is not source identity. Existing exact-create receipt recovery
continues to bind the original body/key, including source/copy intent. Unknown
write outcomes keep the draft locked rather than converting it into a copy.

New content edits send the loaded revision and updated-at timestamp. Current
User/session/role/household/feature checks and a row lock precede the comparison
and ingredient replacement. A stale edit is refused with its local text kept.
The timestamp also detects older servers that touched content without knowing
the additive revision. Unmarked old callers remain supported; arbitrary mixed
old-server writes are not claimed revision-aware. All forward/rollback and
current/previous-client combinations still belong to later QA. Recipe edits
never change linked meal name snapshots, create new meal IDs, consume stock or
change already-eaten portions. Detailed ingredient/cooked-history reconciliation
remains tracked separately within the full recipe reuse work.

### Household curation

Favorites are shared household choices, not an inferred personal preference.
Named collections are household-owned and normalized by name. Parent/teen can
create, rename or explicitly confirm deletion; child can read/filter, consistent
with the recipe role contract. Same-name create returns the existing collection;
rename/delete require its current revision. Deleting a collection removes only
group memberships, keeping Recipe records, favorites, planned meals and prep.
Up to 100 named collections and eight memberships per recipe are supported.

The EN/ES Organize sheet reads current recipe state and collection names only
when opened. Favorite and memberships save atomically against a recipe revision.
An exact already-applied state is a no-op. Stale/uncertain results require an
explicit refresh and review; refreshed metadata does not silently replace the
draft choices, issue another write or claim an earlier request succeeded.
Pending close/navigation and retained-handler guards remain in force. Missing
collections stay visible as unavailable choices until explicitly removed.

Explore has server-backed Favorites and Collection filters alongside saved
search. Collection management uses a short rounded sheet with create/rename and
confirmed delete, retaining its name draft on failure. Readable canonical detail
shows stored original source with the old-prefix fallback. Household export
includes collection names, memberships and new recipe metadata, including empty
collections; erasure inventories explicitly include memberships/collections.
No collection is created in a second AI-owned store or exposed on paired APIs.

Focused unexecuted test source covers same-source concurrency, family edits,
deliberate copies, old Source prefixes, revision conflicts, exact-state retry,
collection deletion, application and composite-FK isolation, child write denial,
URL/selection bounds and UI refresh-after-uncertain behavior. Consolidated QA
must generate the client/apply the migration to a disposable database, run the
full affected tests/checks and inspect the actual EN/ES/role/device journeys.
No migration, test/type/lint/build/browser run, provider call, push, merge or
deployment occurred. These three requested features are coded candidates, not
verified release acceptance.

Rollback retains additive tables/columns and source data. Revert only UI/routes
when pausing the feature; do not drop collections or provenance to run an older
server. New strict payload fields are refused by older strict readers before
mutation. Final deployment compatibility still requires the integrated gates.


## Prepared recipe evidence source candidate — 2026-10-19 (#460)

A linked prep dish now records a versioned canonical recipe snapshot when its
session is first marked prepared: title, description, instructions, source,
revision, base servings/times and ingredient amounts/units/notes. The snapshot
contains no account, creator or model context. Current household authorization
and recipe locks precede capture. All session recipes are validated before
writes; snapshot/prepared state and the existing mutation receipt commit or
roll back together. Capture is bounded to eight dishes, 100 ingredient lines per
recipe and 512 KiB per record. Invalid legacy details refuse preparation with the
plan retained, rather than silently omitting history or truncating instructions.

Recipe edits, ingredient replacement and recipe deletion cannot rewrite stored
cooked evidence. Repeated prepared requests never recapture. Existing prepared
sessions remain NULL/unrecorded; no backfill claims today's recipe was used in
an earlier cook. Manual dishes retain their canonical dish/portion records
without a fabricated recipe. Eaten, Undo, allocation and next-prep quantities
keep their existing path; this adds no stock consumption or grocery mutation.
Planned dishes use the current recipe until prepared. The existing
BATCH_ALREADY_PREPARED grocery refusal remains in force for cooked batches.

The short read-only Recipe used sheet fetches one batch's history on demand,
with bounded waiting, cancellation and stale-response guards. It reports missing
history honestly and renders authored recipe text with EN/ES interface labels.
`GET /api/meals/bulk/[id]/recipe` uses existing fresh verified parent/teen,
session/household/meals authority and private/no-store responses. It refuses
unknown versions/partial records without rewriting stored data. Prep lists send
only the capture timestamp; household export includes the full evidence. The
existing owned MealBatch erasure lifecycle removes snapshots with their batch.

The expand-only `migration-zzz-recipe-prep-history.sql` follows the bulk-cooking
migration. Rollback retains its nullable columns and JSON evidence; older
servers may create unrecorded sessions, never backfilled as historical truth.
Disposable-DB/contract test source covers frozen content, canonical deletion,
repeat preparation, all-dish refusal and legacy unrecorded sessions. UI test
source covers recorded/missing/future evidence and late responses after a batch
change. Ingredient capture reads at most 101 lines and refuses over-limit legacy
recipes before loading their ingredient detail. These tests
are not executed. Later integrated QA must apply the schema/generate a private
client, exercise authority/role/device and concurrent write/recovery paths,
check eaten/Undo/next-prep quantities and inspect EN/ES rendering. No migration,
generation, checks/build/browser QA, provider call, push, merge or deployment.
Full #460 acceptance and broader discovery/reuse reconciliation remain open.
