# Recipe discovery (#460)

## Current implementation candidate — 2026-10-19

The local candidate supports fixed-publisher single/all-source discovery, bounded
public JSON-LD preview with explicit truncation/missing-data review, canonical
source identity and duplicate/copy choices, exact-create recovery, full saved
search, shared favorites/collections, direct meal/prep reuse, portion preview,
reviewed grocery destination/selection and cooked recipe evidence. These are
source states; runtime/role/device/rollback acceptance and release are unproven.

| Requirement | Current authoritative source | State / limit |
| --- | --- | --- |
| Online search | `/api/recipes/discover`, Explore | One or all three fixed publishers; 24 title/link results, source attribution and partial outage. Not a comprehensive licensed index. |
| Public link parse/review | `recipe-discovery.ts`, `recipe-preview-contract.ts`, `/api/recipes/preview` | Bounded JSON-LD; explicit incomplete/unknown review; full bounded draft text retained. Optional model/image/PDF parsing is not activated. |
| Canonical save/retry | `recipe-write.ts`, RecipeEditor | Household lock, source identity, atomic pointer receipt, explicit copy; no silent background overwrite. |
| Find/organize | `recipe-search.ts`, RecipeCuration/RecipeCollections | Server-backed saved constraints, favorites and collections; no second provider-owned library. |
| Meal/prep reuse | RecipeReuseLauncher, `/api/meals/create`, MealPrepEditor | Same saved Recipe ID; deliberate day/slot/portion review and keyed save/restore. |
| Portion/cooking reader | RecipeCookingView/RecipeDetail | Numeric reviewed amounts only, 1–100 preview; no unit conversion or altered directions/times. |
| Groceries | AddToGroceriesButton, `grocery-from-recipe.ts` | Explicit selection/destination/scaling, source dedupe and owned Undo; presence is not enough-stock confidence. |
| Cooked history | `meal-recipe-history.ts`, PreparedRecipe | Snapshot at first prep completion; legacy history remains explicitly unrecorded. |
| Eligibility/provider dependencies | #567, #125 | No paid model/product-data service, image/PDF capability or live family processing activated. |
| Integrated evidence | Consolidated QA after implementation | All new source tests, schema/client preparation, runtime/device/privacy/compatibility evidence still required. |

The detailed dated sections below preserve earlier staged decisions. Statements
about missing features in earlier stages are historical, superseded by the
current matrix and later source entries. Optional provider feasibility remains
an external decision, not a claim that the broad goal is blocked or complete.

## Earlier stages and retained implementation history

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


## Direct reuse and ordinary meal confirmation source — 2026-10-19

Saved detail exposes Plan a meal and Add to prep for personal parent/teen viewers.
The destination receives only the recipe ID. The EN/ES reuse launcher reads owned
canonical summary metadata with a 10-second bound, cancels stale loads, and asks
for a deliberate editor action. Missing/foreign/invalid recipes offer retry and
Dismiss; they never become guessed free-text meals. Dismiss removes only the
recipe intent, retaining the selected week/view and unrelated URL parameters.
The same existing Recipe ID seeds the ordinary meal editor or first prep dish.
Dates, slot, cook and portions remain reviewable; a prep can add several dishes.
Recipe base servings populate ordinary meals up to 100 and prep up to its existing
50-portion cap; larger/unknown prep bases retain the visible default of eight for
review. None of these actions imports a duplicate or consumes stock.

Ordinary create now uses `GET/POST /api/meals/create`. GET supplies fresh current
personal context; POST requires the strict `herewoven.meal-create.v1` envelope,
that expected user/family, issued-at and stable Idempotency-Key. This dedicated
path is important because older `POST /api/meals` readers strip unknown fields;
a body marker sent there could not establish rollback-safe exact retry. An older
server lacking the dedicated endpoint cannot silently receive a legacy fallback.
The original route remains for old clients; its behavior is not retroactively
claimed keyed. No new offline/native action or manifest capability is advertised.

The write locks current User, household and receipt, renews existing ordinary
meal role/session/meals authority (including its existing unverified-person
policy), validates cook and recipe in that household, and commits FamilyMeal and
its compact `{mealId}` receipt together. Completed replay renews authority and
checks current owned existence. Deleted meals stay deleted. A new execution more
than the receipt TTL minus one hour after its issued-at, or with clock skew more
than one minute into the future, is refused; an expired receipt cannot recreate
an abandoned request. Beta usage counts run only after a newly committed create,
never for a receipt replay. No schema or account-deletion changes are needed.

The ordinary form waits for context before editing, owns synchronous and rendered
pending state, and retains exact key/body after timeout, malformed success or
lost response. A later refusal cannot erase uncertainty. Explicit Check the same
save retries that body, with a read-only plan link in another tab. It does not
create a fresh key, re-resolve household intent or claim an unknown save failed.
A canonical deleted-meal confirmation resolves the old attempt without recreating
it. Ordinary meal Undo acquires context before deletion and retains its own
key/issued-at/body across Check same restore attempts. Prep allocation Undo keeps
its existing exact-request path. Canonical reload reflects the resulting state.

Unexecuted contract/transaction/UI source covers the new envelope, concurrent
confirmation, receipt/meal rollback, deleted replay, context/token/expiry refusal,
missing recipe/cook, original body/key after uncertainty/refusal, explicit reuse
and stale recipe loads. Existing meal-page fixtures include the new context and
receipt path. Full two-household, role, rollback, expired-intent, lost-response,
EN/ES and responsive/native journeys still need the consolidated QA pass.
No tests/type/lint/build/browser QA, schema generation/migration, provider call,
push, merge or deployment occurred. Full #460 acceptance remains open; reconcile
remaining parser review, discovery constraints and reading/scaling before QA.


## Cooking portions preview source — 2026-10-19

The saved reader has an EN/ES Cooking portions input and Original reset for known
base servings. A whole 1–100 target scales reviewed numeric ingredient amounts
only, preserving the exact authored unit, note, directions and cooking times.
It does not parse ingredient prose, convert units, guess missing base servings or
write the Recipe. Invalid input explicitly shows original amounts; unknown base
servings have no scaler. The prepared-history reader remains an unscaled record.
Display uses four significant digits so tiny nonzero quantities do not round to
zero. The preview and rounding policy are visible; canonical amounts remain raw.

The grocery action receives the same valid target and opens the existing
selection/destination/scaled-amount review before any write. Its explicit request
ceiling now matches Recipe and ordinary meal servings at 100; bulk prep remains
1–50. Older grocery servers may refuse a >50 explicit target before writing,
without a client fallback or clamped request. Existing owned provenance,
idempotency, per-source duplicate checks and Undo remain the server authority.
The scaler is local to the loaded recipe version and resets on canonical version
replacement; it does not rewrite the plan or cooked history.

Focused source covers ratio arithmetic, tiny amounts, original reset, invalid and
unknown serving states, stable authored directions/data and the 100/101 grocery
boundary. Existing boundary fixtures now use 101 for invalid explicit requests.
No tests/type/lint/build/browser QA, provider call, schema change, push, merge or
deployment. Later integrated QA must inspect scaling alongside editor, recipe
curation and pending grocery add/Undo ownership across version/role/device paths.


Grocery add/Undo now own the pending-navigation controller while a request or
uncertain recovery is active. The reader freezes portion changes, recipe edit/
curation controls and reuse links during that ownership. Exact add body/key are
retained even when a later retry is refused; uncertain Undo keeps its original
receipt and retry control beyond the display timer. New review cannot replace
an owned unknown action. Ownership releases before canonical-change callbacks
on known completion. The cooking reader resets its local portion choice on a
canonical version change without keying/remounting the grocery component by
version. Focused unexecuted source covers retained ownership/body/key through
lost response, later refusal and eventual confirmation. Rendered/native Back
and full parent-sheet ownership remain required consolidated QA evidence.


## Explicit import review source — 2026-10-19

Public JSON-LD extraction now returns typed review issues for title/description
shortening, ingredient/step omissions and unknown/missing servings, prep time,
cook time, ingredients and directions. Numeric fractional/out-of-range yields
stay unknown. Traversal is bounded to 64 JSON-LD blocks, 2,000 graph nodes,
2,000 instruction nodes, eight instruction nesting levels, 100 steps/ingredient
lines, 500 characters per ingredient and 14,000 directions characters; current
2 MiB/public-DNS/redirect/timeout transport remains the outbound boundary. Any
returned content clipped by these bounds carries the corresponding review issue.
Source commands remain untrusted text, never app actions or trusted model input.

Explore validates recipe HTTP JSON with the shared client-safe schema and shows
EN/ES review notices alongside the original link. Missing data stays unknown;
older previews missing extraction-limit reports receive a compare-original
notice. Unknown future metadata is refused with the manual/original-source
fallback. The preview read has a 15-second client deadline and generation guard,
so an aborted/unmounted read cannot populate a replacement preview. Server
request JSON is stream-bounded to 8 KiB, accepts only the bounded URL field and
sets private/no-store on success, auth/feature/role refusal and failure.

The import editor receives every bounded extracted ingredient line plus the
extracted directions; it no longer silently slices the combined draft to 20,000
characters. A larger draft stays editable and visibly over the save ceiling.
Title/description/method length checks refuse locally before any create/edit
request until the user explicitly shortens the text. The stored canonical schema
limits do not change. Imported missing servings start empty, with the existing
1–100 validation; two servings are no longer invented for an unknown import.
Manual new recipes retain their visible editable default. Missing times remain
blank. Raw ingredient prose stays in the method until manually reviewed into
structured quantities; no numeric conversions, allergens or nutrition are guessed.

Unexecuted source covers repeated/deep steps, omitted/long ingredient lines,
fractional yields, unknown metadata/unsafe links, raw source commands as text,
full combined-draft retention, blank imported servings and over-limit local
refusal without requests. Existing preview API fixtures cover strict/bounded
input, no outbound work for refusal and private response headers. No actual
publisher call, provider/model activation, media retention, QA/type/lint/build/
browser pass, schema operation, push, merge or deployment. Full acceptance still
requires consolidated source/runtime/role/device/security and rollback evidence.
Remaining discovery breadth and the rest of the completion ledger remain open.


## Bounded all-supported-source discovery — 2026-10-19

The source selector adds All supported sites, retaining its original single-site
default. `POST /api/recipes/discover` accepts only the three fixed publisher IDs
or `all`, with a 2–120 character query and strict 8 KiB streamed body. One all
request runs at most three independent 10-second/2 MiB public-DNS-pinned reads;
there is no arbitrary URL, retry fan-out, saved stock/household content, cookie,
credential or model call. The existing 15/minute/user request limit remains.

Up to 24 unique title/link results are interleaved round-robin, so one publisher
cannot occupy all places. All-source cards name their publisher. Each selected
site reports available-links, empty extraction or unavailable state; empty is
not a promise of comprehensive coverage. Partial outages preserve other source
links with explicit EN/ES incomplete-results copy; total outage retains all
original publisher search links and the manual/link-import paths. Nothing is
saved by search. This adds no new publisher, licensed catalog or paid provider.

The client validates results/coverage metadata, bounds search waiting to 15
seconds and invalidates older/unmounted queries. Every route response is
private/no-store, including auth/feature/rate/body/upstream failures. Focused
unexecuted fixtures cover three-host-only fan-out, source attribution, outage,
no writes, invalid extra fields/oversize input, safe result URLs and coverage.
No actual publisher request, QA/type/lint/build/browser run, provider activation,
schema operation, push, merge or deployment. Full #460 acceptance still requires
the later integrated workflow/role/device/security/rollback evidence.

Discovery URLs keep meaningful recipe query values while removing only known
tracking parameters and fragments, matching the saved source-identity policy.
Links longer than 1,500 characters are skipped before forming a response.
Unexecuted source covers two recipe-specific variants and tracking deduplication;
this avoids turning distinct publisher links into the same query-free URL.
