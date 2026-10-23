# Custom lists and private list-cover source reconciliation

Original #447/#454 under #128/#499. Source inventory: 2026-10-20. These are
implementation/acceptance-source mappings, not executed QA or release evidence.

## #447: Custom lists

| Original criterion | Current canonical source | Remaining proof |
| --- | --- | --- |
| Select Custom and submit the existing API | CreateListForm supports `custom`, name and optional description and posts `/api/lists/create` | Existing form creation/double-submit and API custom-list cases; actual routes deferred |
| Shared type/server validation, permissions and household | `ListType`, LIST_TYPE_KEYS and createListSchema include custom; route derives household/creator from auth, permits parent/teen and now renews authority for all creates under actor then household locks | Existing validation/role/isolation source plus new waiting-authority source; execution deferred |
| EN/ES overview/filter/empty states and literal list names | Typed list-create/list-overview dictionaries, TYPE_CONFIG custom entry and canonical list-type filters; names remain household text | Existing type-filter/localization source; actual locales/long names/reflow deferred |
| Ordinary checklist, no grocery automation | `isGroceryListType('custom')` is false; ordinary detail/item/check/undo paths remain canonical | Existing custom-list and item/section/offline source; integrated role/behavior acceptance deferred |
| Existing retry semantics remain | Canonical shared item retry/idempotency paths are unchanged. The list-create form retains its single-flight submission behavior; no new list-create replay guarantee is claimed | Existing form-double-submit and list-item recovery/integration source remain to execute |

List.type remains a string; no migration added by Custom. Legacy meal_plan and
other list types remain accepted/readable. Rollback can remove optional Custom
picker/filter additions while keeping saved custom records generic checklists.

## #454: Private list covers

| Original criterion | Current source | Remaining proof |
| --- | --- | --- |
| Optional folded image picker, upload/preview/replace/remove, clear error/busy, wait before create | ListImagePicker uses existing private `/api/upload`, validates returned private image path, keeps picker folded, previews and clears local selection without deleting a file; CreateListForm blocks submit/dismissal during upload | `list-image-picker.test.tsx`, actual form and sheet source; rendered/upload/failure/payload journeys deferred |
| Additive nullable schema | List.image_url is nullable; `scripts/migrate.js` uses ADD COLUMN IF NOT EXISTS | Isolated generated client/schema/type checks, rollback-only migration rehearsal and full build deferred; no schema operations performed |
| Exact owned Upload, no external/foreign disclosure | `resolveChorePhotoForWrite` with no current-value bypass validates the exact family Upload and canonicalizes its private path; list route returns the same generic attachment refusal for missing/foreign/external references | Existing custom-list route and image source; actual private file access/role/household negative checks deferred |
| Locked membership/role/cleanup attachment | All creates now take actor-user then household-existence locks, renew current membership/create role and session generation, then resolve cover through that transaction and create the list atomically | New fake waiting-authority cases and disposable-Postgres held-lock source are authored but unrun |
| Saved covers in overview/detail; old lists readable | ListsClient conditionally renders cover thumbnail; detail page conditionally renders private image; absent/null values retain ordinary list rendering | Actual overview/detail/private-file/old-list route acceptance deferred |
| Cleanup/quota protects shared references; no eager deletion | upload-housekeeping scans List.image_url initially and rechecks under the same household lock before stale deletion. Remove/replace only change the local reference; ordinary stale cleanup/quota apply | Existing cleanup race source plus new disposable-Postgres attachment-after-candidate/cleanup-before-attachment cases remain unrun |
| Role/current-household authority and no new service | Parent/teen creation only, household from auth, private Upload/file service retained | Full API and person/device/role journeys deferred; no live mutation or provider changes |

## Reconciled code gap

Previously only creates containing a cover entered the transaction; uncovered
lists could use stale role/membership, and even the cover branch did not renew a
session generation after waiting. Both paths now share one locked transaction.
A revoked captured generation yields 401; removed/unauthorized creators cannot
write. The photo helper accepts an optional upload delegate so this route reads
through its transaction instead of a global client; unchanged legacy callers
keep the default. Existing request/response shapes and image normalization stay.

Authored source covers cover/no-cover stale role/membership/session, lock order,
real held actor locks, a cover removed before attachment acquires its lock,
cleanup retaining a cover attached after its candidate snapshot, and resolution
of an uncommitted transaction-owned Upload followed by rollback. Fake cases are
not a substitute for Postgres cases; neither has been executed in this pass.

No tests, types, lint, build, browser/native/schema operations, CI, push, merge,
deployment or activation. Rollback may retain nullable image_url for old-client
compatibility. Keep the server ownership/authority guards; no eager shared-file
delete, public URL, item gallery, permission expansion or new upload service.
