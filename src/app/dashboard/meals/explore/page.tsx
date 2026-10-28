"use client";

import * as React from "react";
import { MealContextLink as Link } from "@/components/meals/MealContextLink";
import { FeatureGate } from "@/components/ui/feature-gate";
import { Dialog } from "@/components/ui/dialog";
import { MealViewNav } from "@/components/meals/MealViewNav";
import { RecipeEditor } from "@/components/meals/RecipeEditor";
import { RecipeCuration } from "@/components/meals/RecipeCuration";
import { RecipeCollections } from "@/components/meals/RecipeCollections";
import {
  canonicalRecipeSource,
  legacyRecipeSource,
} from "@/lib/recipe-curation-contract";
import {
  onlineRecipeSchema,
  importedRecipeInstructions,
  recipeImportIssues,
  recipeDiscoveryResponse,
} from "@/lib/recipe-preview-contract";
import { useRecipeExploreText } from "@/i18n/recipe-explore";
import {
  publicRecipeUrl,
  recipeSources,
  type OnlineRecipe,
} from "@/lib/recipe-discovery";

import { requestOwnedJson } from "@/lib/owned-request-http";
import { requestRecipeCurationJson } from "@/lib/recipe-curation-client";
import { RecipeLibraryOwnerChanged, readRecipeLibraryPage, type RecipeLibrarySummary as SavedRecipe } from "@/lib/recipe-library-client";
import { RECIPE_OWNER_HEADER, readRecipeOwner, sameRecipeOwner, type RecipeOwner } from "@/lib/recipe-owner-contract";
import { useRecipeCurationText } from "@/i18n/recipe-curation";
type RecipeSearchResult = { title: string; url: string; source?: string };

export default function RecipeExplorePage() {
  const text = useRecipeExploreText();
  const curationText = useRecipeCurationText();
  const [ownerHold, setOwnerHold] = React.useState(false);
  const libraryOwner = React.useRef<RecipeOwner | null>(null);
  const libraryHeld = React.useRef(false);
  const reloadFocus = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { if (ownerHold) reloadFocus.current?.focus(); }, [ownerHold]);
  const [query, setQuery] = React.useState("");
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [collectionId, setCollectionId] = React.useState("");
  const [savedQuery, setSavedQuery] = React.useState("");
  const [ingredient, setIngredient] = React.useState("");
  const [maxPrep, setMaxPrep] = React.useState("");
  const [minServings, setMinServings] = React.useState("");
  const [libraryFilters, setLibraryFilters] = React.useState("");
  const [source, setSource] = React.useState<string>(recipeSources[0].name);
  const [resultLimit, setResultLimit] = React.useState(6);
  const [results, setResults] = React.useState<RecipeSearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState("");
  const [searched, setSearched] = React.useState(false);
  const [incompleteSearch, setIncompleteSearch] = React.useState(false);
  const searchGeneration = React.useRef(0);
  const searchController = React.useRef<AbortController | null>(null);
  const [url, setUrl] = React.useState("");
  const [recipes, setRecipes] = React.useState<SavedRecipe[]>([]);
  const [offset, setOffset] = React.useState<number | null>(0);
  const [loadingLibrary, setLoadingLibrary] = React.useState(false);
  const [libraryError, setLibraryError] = React.useState("");
  const [canSave, setCanSave] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const importSection = React.useRef<HTMLDetailsElement>(null);
  React.useEffect(() => { if (error && importSection.current) importSection.current.open = true; }, [error]);
  const [preview, setPreview] = React.useState<OnlineRecipe | null>(null);
  const [editor, setEditor] = React.useState(false);
  const [copyImport, setCopyImport] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [embedded, setEmbedded] = React.useState(false);
  const [savedId, setSavedId] = React.useState<string | null>(null);
  const libraryBusy = React.useRef(false);
  const importBusy = React.useRef(false);
  const controller = React.useRef<AbortController | null>(null);
  const previewGeneration = React.useRef(0);
  const libraryController = React.useRef<AbortController | null>(null);

  const holdLibraryOwner = React.useCallback(() => {
    libraryHeld.current = true;
    setOwnerHold(true);
    setCanSave(false);
    setRecipes([]);
    setPreview(null);
    setEditor(false);
    setSavedId(null);
    previewGeneration.current++;
    searchGeneration.current++;
    controller.current?.abort();
    searchController.current?.abort();
  }, []);

  const loadLibrary = React.useCallback(
    async (next: number) => {
      if (libraryBusy.current || libraryHeld.current) return;
      libraryBusy.current = true;
      const abort = new AbortController();
      libraryController.current = abort;
      setLoadingLibrary(true);
      setLibraryError("");
      if (next === 0) {
        setRecipes([]);
        setOffset(0);
      }
      try {
        const data = await readRecipeLibraryPage(libraryFilters, next, abort.signal, fetch, libraryOwner.current);
        if (!abort.signal.aborted) {
          // An online request may have pinned the owner while this first
          // library request was still in flight. Never merge bootstrap races.
          if (libraryOwner.current && !sameRecipeOwner(libraryOwner.current, data.owner)) { holdLibraryOwner(); return; }
          if (!libraryOwner.current) libraryOwner.current = data.owner;
          setCanSave(["parent", "teen"].includes(data.owner.role));
          setRecipes((previous) => next === 0 ? data.recipes :
            [...new Map([...previous, ...data.recipes].map(recipe => [recipe.id, recipe])).values()]);
          setOffset(data.nextOffset);
        }
      } catch (error) {
        if (!abort.signal.aborted && error instanceof RecipeLibraryOwnerChanged) holdLibraryOwner();
        else if (!abort.signal.aborted) setLibraryError(text("libraryError"));
      } finally {
        if (!abort.signal.aborted) {
          libraryBusy.current = false;
          setLoadingLibrary(false);
        }
      }
    },
    [text, libraryFilters, holdLibraryOwner],
  );

  React.useEffect(() => {
    const advisory = new AbortController();
    // Manual import remains available during a library-only failure. This role
    // hint cannot replace an admitted library owner or authorize any API write.
    void requestOwnedJson("/api/auth/me", { signal: advisory.signal }, 64 * 1024).then(result => {
      if (advisory.signal.aborted || libraryHeld.current || libraryOwner.current || result.kind !== "reply" || !result.response.ok) return;
      const body = result.body as { user?: { role?: unknown } } | null;
      setCanSave(body?.user?.role === "parent" || body?.user?.role === "teen");
    });
    return () => {
      advisory.abort();
      previewGeneration.current++;
      controller.current?.abort();
      searchGeneration.current++;
      searchController.current?.abort();
      libraryController.current?.abort();
      libraryBusy.current = false;
    };
  }, []);
  React.useEffect(() => {
    void loadLibrary(0);
    return () => {
      libraryController.current?.abort();
      libraryBusy.current = false;
    };
  }, [loadLibrary]);

  const admitOnlineOwner = (response: Response) => {
    if ([401, 403, 409].includes(response.status)) { holdLibraryOwner(); return false; }
    if (!response.ok) return true;
    const received = readRecipeOwner(response.headers?.get(RECIPE_OWNER_HEADER) ?? null);
    if (!received || (libraryOwner.current && !sameRecipeOwner(libraryOwner.current, received))) {
      holdLibraryOwner(); return false;
    }
    if (!libraryOwner.current) libraryOwner.current = received;
    setCanSave(["parent", "teen"].includes(received.role));
    return true;
  };

  const readRecipe = async (event?: React.FormEvent, selectedUrl = url) => {
    event?.preventDefault();
    if (libraryHeld.current || !canSave || importBusy.current) return;
    const link = publicRecipeUrl(selectedUrl.trim());
    if (!link) {
      setError(text("invalidLink"));
      return;
    }
    const own = ++previewGeneration.current;
    const current = () => own === previewGeneration.current;
    importBusy.current = true;
    setLoading(true);
    setError("");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await requestRecipeCurationJson("/api/recipes/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(libraryOwner.current ? { [RECIPE_OWNER_HEADER]: JSON.stringify(libraryOwner.current) } : {}) },
        body: JSON.stringify({ url: link }),
        signal: abort.signal,
      }, 512 * 1024);
      if (result.kind !== "reply") throw new Error("Recipe preview unavailable");
      const { response } = result;
      if (!current() || abort.signal.aborted || !admitOnlineOwner(response)) return;
      const data = result.body as { recipe?: unknown } | null;
      const parsed = onlineRecipeSchema.safeParse(data?.recipe);
      if (!response.ok || !parsed.success) {
        if (current() && !abort.signal.aborted) setError(text("readFailed"));
        return;
      }
      if (current() && !abort.signal.aborted) {
        setPreview(parsed.data);
        setEditor(false);
        setCopyImport(false);
        setEmbedded(false);
        setSavedId(null);
      }
    } catch {
      if (current() && !abort.signal.aborted)
        setError(text("readNetworkError"));
    } finally {
      if (current() && !abort.signal.aborted) {
        importBusy.current = false;
        setLoading(false);
      }
    }
  };

  const searchOnline = async (event: React.FormEvent) => {
    event.preventDefault();
    if (libraryHeld.current) return;
    searchController.current?.abort();
    const own = ++searchGeneration.current;
    const current = () => own === searchGeneration.current;
    const abort = new AbortController();
    searchController.current = abort;
    setSearching(true);
    setSearchError("");
    setResults([]);
    setResultLimit(6);
    setSearched(false);
    setIncompleteSearch(false);
    try {
      const result = await requestRecipeCurationJson("/api/recipes/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(libraryOwner.current ? { [RECIPE_OWNER_HEADER]: JSON.stringify(libraryOwner.current) } : {}) },
        body: JSON.stringify({ query: query.trim(), source }),
        signal: abort.signal,
      }, 512 * 1024);
      if (result.kind !== "reply") throw new Error("Recipe search unavailable");
      const { response } = result;
      if (!current() || abort.signal.aborted || !admitOnlineOwner(response)) return;
      const parsed = recipeDiscoveryResponse.safeParse(result.body);
      if (!response.ok || !parsed.success) {
        if (current() && !abort.signal.aborted)
          setSearchError(text("searchFailed"));
        return;
      }
      if (current() && !abort.signal.aborted) {
        setResults(parsed.data.results);
        setIncompleteSearch(
          parsed.data.sources?.some(
            (source) => source.state === "unavailable",
          ) ?? false,
        );
        setSearched(true);
      }
    } catch {
      if (current() && !abort.signal.aborted)
        setSearchError(text("searchNetworkError"));
    } finally {
      if (current() && !abort.signal.aborted) setSearching(false);
    }
  };

  const visible = recipes;
  const existing = preview
    ? recipes.find(
        (recipe) =>
          (recipe.source_url
            ? canonicalRecipeSource(recipe.source_url)
            : legacyRecipeSource(recipe.description)) ===
          canonicalRecipeSource(preview.source),
      )
    : undefined;

  if (ownerHold) return (
    <FeatureGate featureKey="meals">
      <div role="alert" className="space-y-3">
        <p>{curationText.ownerChanged}</p>
        <button ref={reloadFocus} type="button" className="btn-secondary min-h-[44px]" onClick={() => window.location.reload()}>{curationText.reload}</button>
      </div>
    </FeatureGate>
  );
  return (
    <FeatureGate featureKey="meals">
      <div className="space-y-6 pb-20">
        <header>
          <h1 className="text-large-title font-display">{text("title")}</h1>
          <p className="text-subhead text-label-secondary">
            {text("subtitle")}
          </p>
        </header>

        <MealViewNav active="explore" />
        {canSave && (
          <Link className="btn-plain min-h-11" href="/dashboard/meals/review">
            {text("savedWork")}
          </Link>
        )}

        <details className="card-apple p-4 space-y-3">
          <summary id="recipe-discovery-title" className="min-h-[44px] cursor-pointer content-center text-title-3">
            <h2 className="inline">{text("findOnline")}</h2>
            {searching && <span role="status" className="ml-2 text-footnote">{text("searching")}</span>}
          </summary>
          <form onSubmit={searchOnline} className="space-y-3">
            <label className="label-apple" htmlFor="recipeSearch">
              {text("searchPrompt")}
            </label>
            <input
              id="recipeSearch"
              className="input-apple"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={text("searchPlaceholder")}
              maxLength={120}
              minLength={2}
              required
            />
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[180px] sm:max-w-sm">
                <label className="label-apple" htmlFor="recipeSource">
                  {text("source")}
                </label>
                <select
                  id="recipeSource"
                  className="input-apple min-h-[44px]"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                >
                  <option value="all">{text("allSources")}</option>
                  {recipeSources.map((recipeSource) => (
                    <option key={recipeSource.name}>{recipeSource.name}</option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="btn-filled min-h-[44px]"
                disabled={searching}
              >
                {searching ? text("searching") : text("searchRecipes")}
              </button>
            </div>
          </form>
          {searchError && (
            <p role="alert" className="text-[var(--danger-text)]">
              {searchError}
            </p>
          )}
          {incompleteSearch && (
            <p role="status" className="text-footnote">
              {text("partialSearch")}
            </p>
          )}
          {searched && results.length === 0 && (
            <p role="status" className="text-label-secondary">
              {text("noSearchResults")}
            </p>
          )}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {results.slice(0, resultLimit).map((result) => (
              <li
                key={result.url}
                className="rounded-xl border border-[var(--surface-separator)] p-3 min-w-0"
              >
                <p className="text-headline break-words">{result.title}</p>
                {result.source && (
                  <p className="text-footnote text-label-secondary">
                    {result.source}
                  </p>
                )}
                <p className="text-footnote text-label-secondary">
                  {new URL(result.url).hostname}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {canSave && (
                    <button
                      className="btn-tinted min-h-[44px]"
                      disabled={loading}
                      onClick={() => {
                        setUrl(result.url);
                        void readRecipe(undefined, result.url);
                      }}
                    >
                      {text("readRecipe")}
                    </button>
                  )}
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-plain min-h-[44px]"
                  >
                    {text("openOriginal")}
                  </a>
                </div>
              </li>
            ))}
          </ul>
          {results.length > resultLimit && (
            <button
              className="btn-tinted min-h-[44px]"
              onClick={() => setResultLimit((previous) => previous + 6)}
            >
              {text("showMore")}
            </button>
          )}
          <div className="flex flex-wrap gap-2">
            {recipeSources.map((recipeSource) => (
              <a
                key={recipeSource.name}
                href={`${recipeSource.search}${encodeURIComponent(query.trim())}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-tinted min-h-[44px]"
              >
                {text("searchSource", { source: recipeSource.name })}
              </a>
            ))}
          </div>
          <p className="text-footnote text-label-secondary">
            {text("directSearchHint")}
          </p>
        </details>

        {canSave && (
          <details ref={importSection} className="card-apple p-4">
            <summary id="import-title" className="min-h-[44px] cursor-pointer content-center text-title-3">
              <h2 className="inline">{text("saveFromLink")}</h2>
              {loading && <span role="status" className="ml-2 text-footnote">{text("reading")}</span>}
            </summary>
            <form
              onSubmit={(event) => void readRecipe(event)}
              className="flex flex-wrap gap-3"
            >
              <div className="flex-1 min-w-0 basis-64">
                <label className="label-apple" htmlFor="recipeUrl">
                  {text("recipeLink")}
                </label>
                <input
                  id="recipeUrl"
                  type="url"
                  required
                  className="input-apple"
                  value={url}
                  disabled={loading}
                  maxLength={1500}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={text("recipeLinkPlaceholder")}
                />
              </div>
              <button
                className="btn-filled min-h-[44px] self-end"
                disabled={loading}
                type="submit"
              >
                {loading ? text("reading") : text("readRecipe")}
              </button>
            </form>
            {error && (
              <div className="mt-3">
                <p role="alert" className="text-[var(--danger-text)]">
                  {error}
                </p>
                {publicRecipeUrl(url.trim()) && (
                  <a
                    className="btn-tinted min-h-[44px] mt-2"
                    href={publicRecipeUrl(url.trim())!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {text("openOriginal")}
                  </a>
                )}
              </div>
            )}
          </details>
        )}

        <section aria-labelledby="saved-title">
          <h2 id="saved-title" className="text-title-2 mb-3">
            {text("recipeBox")}
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const filters = new URLSearchParams();
              if (favoritesOnly) filters.set("favorite", "1");
              if (collectionId) filters.set("collection", collectionId);
              if (savedQuery.trim()) filters.set("q", savedQuery.trim());
              if (ingredient.trim())
                filters.set("ingredient", ingredient.trim());
              if (maxPrep) filters.set("maxPrep", maxPrep);
              if (minServings) filters.set("minServings", minServings);
              const next = filters.toString();
              if (next === libraryFilters) void loadLibrary(0);
              else setLibraryFilters(next);
            }}
            className="space-y-3 mb-4"
          >
            <label htmlFor="saved-recipe-search" className="label-apple">
              {text("searchSaved")}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="saved-recipe-search"
                className="input-apple min-w-0 flex-1 basis-48"
                maxLength={120}
                value={savedQuery}
                onChange={(event) => setSavedQuery(event.target.value)}
              />
              <button
                className="btn-tinted min-h-[44px]"
                disabled={loadingLibrary}
              >
                {text("searchSaved")}
              </button>
              {libraryFilters && (
                <button
                  type="button"
                  className="btn-plain min-h-[44px]"
                  onClick={() => {
                    setFavoritesOnly(false);
                    setCollectionId("");
                    setSavedQuery("");
                    setIngredient("");
                    setMaxPrep("");
                    setMinServings("");
                    setLibraryFilters("");
                  }}
                >
                  {text("clearSavedFilters")}
                </button>
              )}
            </div>
            <details>
              <summary className="min-h-[44px] content-center cursor-pointer">
                {text("savedFilters")}
              </summary>
              <div className="grid gap-3 sm:grid-cols-3 mt-2">
                <label className="space-y-1">
                  {text("ingredientFilter")}
                  <input
                    className="input-apple"
                    maxLength={100}
                    value={ingredient}
                    onChange={(event) => setIngredient(event.target.value)}
                  />
                </label>
                <label className="space-y-1">
                  {text("maxPrepFilter")}
                  <input
                    className="input-apple"
                    type="number"
                    min={1}
                    max={1440}
                    step={1}
                    value={maxPrep}
                    onChange={(event) => setMaxPrep(event.target.value)}
                  />
                </label>
                <label className="space-y-1">
                  {text("servingsFilter")}
                  <input
                    className="input-apple"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={minServings}
                    onChange={(event) => setMinServings(event.target.value)}
                  />
                </label>
              </div>
              <p className="text-footnote text-label-secondary mt-2">
                {text("savedFiltersHint")}
              </p>
            </details>
          </form>
          <div className="grid gap-3 sm:grid-cols-2 mb-4">
            <label className="flex min-h-[44px] items-center gap-3">
              <input
                type="checkbox"
                checked={favoritesOnly}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setFavoritesOnly(checked);
                  const filters = new URLSearchParams(libraryFilters);
                  if (checked) filters.set("favorite", "1");
                  else filters.delete("favorite");
                  setLibraryFilters(filters.toString());
                }}
              />
              {text("favoritesOnly")}
            </label>
            {libraryOwner.current && <RecipeCollections
              expectedOwner={libraryOwner.current}
              onOwnerHold={holdLibraryOwner}
              value={collectionId}
              canEdit={canSave}
              onSelect={(id) => {
                setCollectionId(id);
                const filters = new URLSearchParams(libraryFilters);
                if (id) filters.set("collection", id);
                else filters.delete("collection");
                setLibraryFilters(filters.toString());
              }}
            />}
          </div>
          {libraryError && (
            <div role="alert">
              <p>{libraryError}</p>
              <button
                className="btn-tinted min-h-[44px]"
                disabled={loadingLibrary}
                onClick={() => void loadLibrary(offset ?? 0)}
              >
                {text("tryAgain")}
              </button>
            </div>
          )}
          {loadingLibrary && <p role="status">{text("libraryLoading")}</p>}
          {!loadingLibrary && !libraryError && visible.length === 0 && (
            <p className="text-label-secondary">
              {libraryFilters ? text("noSavedSearch") : text("noSaved")}
            </p>
          )}
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((recipe) => (
              <li key={recipe.id} className="card-apple p-4 min-w-0">
                <Link
                  href={`/dashboard/meals/recipes/${recipe.id}`}
                  className="inline-flex min-h-[44px] items-center text-headline break-words"
                >
                  {recipe.favorite ? "★ " : ""}
                  {recipe.title}
                </Link>
                <p className="text-footnote text-label-secondary">
                  {text("readyToUse")}
                </p>
                {canSave && (
                  <RecipeCuration
                    id={recipe.id}
                    expectedOwner={libraryOwner.current ?? undefined}
                    onOwnerHold={holdLibraryOwner}
                    title={recipe.title}
                    favorite={recipe.favorite}
                    onChanged={() => void loadLibrary(0)}
                  />
                )}
              </li>
            ))}
          </ul>
          {offset !== null && !loadingLibrary && recipes.length > 0 && (
            <button
              className="btn-tinted min-h-[44px] mt-3"
              onClick={() => void loadLibrary(offset)}
            >
              {text("loadMore")}
            </button>
          )}
        </section>

        {preview && (
          <Dialog
            open
            title={preview.title}
            variant="form"
            onClose={
              saving
                ? undefined
                : () => {
                    setPreview(null);
                    setEditor(false);
                  }
            }
            closeLabel={text("closeRecipe")}
          >
            <div className="space-y-2 mb-3">
              {preview.reviewIssues === undefined && (
                <p className="text-footnote">{text("importLimitsUnknown")}</p>
              )}
              {recipeImportIssues(preview).length > 0 && (
                <aside
                  className="rounded-xl bg-[var(--surface-fill)] p-3 space-y-1"
                  aria-label={text("importReview")}
                >
                  <p className="text-subhead font-semibold">
                    {text("importReview")}
                  </p>
                  <ul className="list-disc ps-5 text-footnote">
                    {recipeImportIssues(preview).map((issue) => (
                      <li key={issue}>{text(`import_${issue}`)}</li>
                    ))}
                  </ul>
                </aside>
              )}
              {importedRecipeInstructions(preview, text("ingredients")).length >
                20000 && (
                <p role="alert" className="text-footnote">
                  {text("importTooLong")}
                </p>
              )}
            </div>
            {editor ? (
              <>
                <p className="text-footnote text-label-secondary mb-3">
                  {text("reviewBeforeSaving")}
                </p>
                <RecipeEditor
                  expectedRecipeOwner={libraryOwner.current ?? undefined}
                  onOwnerHold={holdLibraryOwner}
                  recoveryIdentity={libraryOwner.current ? { userId: libraryOwner.current.actorId, familyId: libraryOwner.current.familyId } : undefined}
                  initialDraft={{
                    source_url: preview.source,
                    source_copy: copyImport,
                    servings: preview.servings,
                    title: preview.title,
                    description: `Source: ${preview.source}\n${preview.description}`,
                    instructions: importedRecipeInstructions(
                      preview,
                      text("ingredients"),
                    ),
                    prep_time: preview.prep_time,
                    cook_time: preview.cook_time,
                  }}
                  onSavingChange={setSaving}
                  onCancel={() => setEditor(false)}
                  onCreated={(recipe) => {
                    setSavedId(
                      recipe.source_url &&
                        canonicalRecipeSource(recipe.source_url) ===
                          canonicalRecipeSource(preview.source)
                        ? recipe.id
                        : null,
                    );
                    setEditor(false);
                    // A restored draft may come from a different source than
                    // this preview. Refresh canonical summaries instead of
                    // attaching the incoming preview's description to it.
                    void loadLibrary(0);
                  }}
                />
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <a
                    href={preview.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-tinted min-h-[44px]"
                  >
                    {text("openOriginal")}
                  </a>
                  <button
                    className="btn-tinted min-h-[44px]"
                    onClick={() => setEmbedded((value) => !value)}
                  >
                    {embedded ? text("recipeReader") : text("viewOriginalHere")}
                  </button>
                  {savedId || existing ? (
                    <>
                      <Link
                        href={`/dashboard/meals/recipes/${savedId || existing?.id}`}
                        className="btn-filled min-h-[44px]"
                      >
                        {text("openSavedRecipe")}
                      </Link>
                      <button
                        type="button"
                        className="btn-tinted min-h-[44px]"
                        onClick={() => {
                          setCopyImport(true);
                          setEditor(true);
                        }}
                      >
                        {text("reviewCopy")}
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn-filled min-h-[44px]"
                      onClick={() => {
                        setCopyImport(false);
                        setEditor(true);
                      }}
                    >
                      {text("reviewAndSave")}
                    </button>
                  )}
                </div>
                <p className="text-footnote text-label-secondary break-all">
                  {text("sourceLabel", {
                    host: new URL(preview.source).hostname,
                  })}
                </p>
                {embedded ? (
                  <>
                    <p className="text-footnote text-label-secondary">
                      {text("embeddedNotice")}
                    </p>
                    <iframe
                      title={text("originalRecipeFrame", {
                        title: preview.title,
                      })}
                      src={preview.source}
                      sandbox="allow-scripts"
                      referrerPolicy="no-referrer"
                      className="w-full h-[60dvh] rounded-xl border border-[var(--surface-separator)]"
                    />
                  </>
                ) : (
                  <>
                    <p className="text-body whitespace-pre-line">
                      {preview.description}
                    </p>
                    <h3 className="text-headline">{text("ingredients")}</h3>
                    <ul className="space-y-2">
                      {preview.ingredientLines.map((line, index) => (
                        <li key={index} className="text-body break-words">
                          {line}
                        </li>
                      ))}
                    </ul>
                    <h3 className="text-headline">{text("directions")}</h3>
                    <p className="text-body whitespace-pre-line break-words">
                      {preview.instructions || text("directionsUnavailable")}
                    </p>
                  </>
                )}
              </div>
            )}
          </Dialog>
        )}
      </div>
    </FeatureGate>
  );
}
