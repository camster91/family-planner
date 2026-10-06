# Recipe editing contract

- The recipe editor uses the canonical household-scoped POST/PATCH APIs. It does not modify planned-meal name snapshots or rename shared Ingredient records when a line name changes.
- `RecipeIngredient` has no authored position field. Submitted array order is **not** a persisted sequence, and the editor offers no reordering control.
- Canonical POST/PATCH responses and GET detail reads use the same explicit database order: Ingredient `name` ascending under the database collation, then `ingredient_id` ascending, then join `id` ascending. Existing editor drafts start from this returned sequence; read-only detail renders the same sequence. Draft entry order can differ until save/readback. This is deterministic display ordering, not preservation of author-defined ordering.
- Metadata-only edits omit unchanged fields and omit the entire ingredients replacement array. This preserves untouched description/method text and existing join rows, including legacy whitespace.
- A deliberate ingredient change replaces the whole set through the existing API. Unchanged normalized-equivalent ingredient names retain their Ingredient IDs, but join IDs can change. Units and notes in the replacement are normalized by the canonical API; legacy whitespace in other lines is not promised byte-for-byte preservation in this case.
- Cancel, Close and Escape discard local edits without writes. Dismissal is blocked during a pending save. Ambiguous network/server/unreadable-success outcomes do not automatically retry or enable another recipe submission; check saved recipes before starting another create.
- Detail loads and save callbacks are guarded by current route ID and request generation. Navigation invalidates old work; the edit owner is keyed by recipe ID.
- Pending inline creation propagates to the owning meal dialog. Meal submit/delete and dismissal are suspended until the create request settles, and successful creation selects the returned recipe before meal submission resumes.

## Focused checks

Component tests use HTTP mocks and the production shared Dialog, not browser layout evidence. The guarded `recipe-editor-roundtrip.integration.test.ts` uses real Prisma/Postgres and canonical route handlers with mocked session/Next transport. It requires `RUN_DB_INTEGRATION=1 FIXTURES_ALLOW=1` and the existing fixture target guard. Each run creates a unique household namespace, cleans only its exact rows and verifies cleanup. It never reseeds or resets the shared fixture database.

Browser/CI verification remains separate; these checks do not start a preview server.
