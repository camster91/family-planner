"use client";

import * as React from "react";
import { RecipeEditor } from "./RecipeEditor";
import type { RecipeOption } from "./RecipePicker";
import { useRecipeExploreText } from "@/i18n/recipe-explore";
import { requestRecipeCurationJson } from "@/lib/recipe-curation-client";
import {
  onlineRecipeSchema,
  recipeDiscoveryResponse,
  importedRecipeInstructions,
  recipeImportIssues,
  type OnlineRecipe,
} from "@/lib/recipe-preview-contract";
import { publicRecipeUrl } from "@/lib/recipe-discovery";
import {
  RECIPE_OWNER_HEADER,
  readRecipeOwner,
  sameRecipeOwner,
  type RecipeOwner,
} from "@/lib/recipe-owner-contract";

/** Read-only discovery until the existing owned recipe editor explicitly saves.
 * This sits inside the meal form: every action is a button, never a nested form.
 */
export function OnlineRecipePicker({
  onCreated,
  onSavingChange,
  onEditingChange,
  disabled = false,
  isMutationPending,
}: {
  onCreated: (recipe: RecipeOption) => void;
  onSavingChange?: (pending: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
  disabled?: boolean;
  isMutationPending?: () => boolean;
}) {
  const text = useRecipeExploreText();
  const [query, setQuery] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [results, setResults] = React.useState<
    Array<{ title: string; url: string; source?: string }>
  >([]);
  const [preview, setPreview] = React.useState<OnlineRecipe | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [searched, setSearched] = React.useState(false);
  const [resultLimit, setResultLimit] = React.useState(6);
  const [partial, setPartial] = React.useState(false);
  const [held, setHeld] = React.useState(false);
  const owner = React.useRef<RecipeOwner | null>(null);
  const heldRef = React.useRef(false);
  const controller = React.useRef<AbortController | null>(null);
  const generation = React.useRef(0);
  const queryId = React.useId();
  const urlId = React.useId();
  React.useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  const hold = () => {
    heldRef.current = true;
    generation.current++;
    controller.current?.abort();
    onEditingChange?.(false);
    setHeld(true);
    setBusy(false);
    setResults([]);
    setPreview(null);
    setEditing(false);
  };
  async function read(kind: "search" | "preview", selectedUrl = url) {
    if (heldRef.current || disabled || isMutationPending?.()) return;
    const link =
      kind === "preview" ? publicRecipeUrl(selectedUrl.trim()) : null;
    if (kind === "preview" && !link) {
      setError(text("invalidLink"));
      return;
    }
    if (kind === "search" && query.trim().length < 2) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const own = ++generation.current;
    setBusy(true);
    setError("");
    if (kind === "search") {
      setResults([]);
      setResultLimit(6);
      setSearched(false);
      setPartial(false);
    }
    try {
      const response = await requestRecipeCurationJson(
        `/api/recipes/${kind === "search" ? "discover" : "preview"}`,
        {
          method: "POST",
          signal: abort.signal,
          headers: {
            "Content-Type": "application/json",
            ...(owner.current
              ? { [RECIPE_OWNER_HEADER]: JSON.stringify(owner.current) }
              : {}),
          },
          body: JSON.stringify(
            kind === "search"
              ? { query: query.trim(), source: "all" }
              : { url: link },
          ),
        },
        512 * 1024,
      );
      if (abort.signal.aborted || own !== generation.current) return;
      if (response.kind !== "reply") throw new Error("unavailable");
      const reply = response.response;
      if ([401, 403, 409].includes(reply.status)) {
        hold();
        return;
      }
      if (!reply.ok) throw new Error("unavailable");
      const received = readRecipeOwner(reply.headers.get(RECIPE_OWNER_HEADER));
      if (
        !received ||
        (owner.current && !sameRecipeOwner(owner.current, received))
      ) {
        hold();
        return;
      }
      owner.current = received;
      if (kind === "search") {
        const data = recipeDiscoveryResponse.parse(response.body);
        setResults(data.results);
        setSearched(true);
        setPartial(
          data.sources?.some((s) => s.state === "unavailable") ?? false,
        );
      } else {
        const data = response.body as { recipe?: unknown } | null;
        setPreview(onlineRecipeSchema.parse(data?.recipe));
        setEditing(false);
      }
    } catch {
      if (!abort.signal.aborted && own === generation.current)
        setError(text(kind === "search" ? "searchFailed" : "readFailed"));
    } finally {
      if (!abort.signal.aborted && own === generation.current) setBusy(false);
    }
  }
  if (held)
    return (
      <p role="alert" className="text-subhead">
        {text("inlineOwnerChanged")}
      </p>
    );
  const locked = disabled || busy;
  if (preview && editing)
    return (
      <RecipeEditor
        expectedRecipeOwner={owner.current ?? undefined}
        onOwnerHold={hold}
        recoveryIdentity={
          owner.current
            ? {
                userId: owner.current.actorId,
                familyId: owner.current.familyId,
              }
            : undefined
        }
        initialDraft={{
          source_url: preview.source,
          title: preview.title,
          description: preview.description,
          instructions: importedRecipeInstructions(
            preview,
            text("ingredients"),
          ),
          servings: preview.servings,
          prep_time: preview.prep_time,
          cook_time: preview.cook_time,
        }}
        onCreated={(recipe) => {
          onEditingChange?.(false);
          setEditing(false);
          setPreview(null);
          onCreated(recipe);
        }}
        onSavingChange={onSavingChange}
        disabled={disabled}
        isMutationPending={isMutationPending}
        onCancel={() => {
          setEditing(false);
          onEditingChange?.(false);
        }}
      />
    );
  if (preview)
    return (
      <section className="space-y-3" aria-label={preview.title}>
        <button
          type="button"
          className="btn-plain min-h-11"
          disabled={disabled}
          onClick={() => setPreview(null)}
        >
          {text("inlineBack")}
        </button>
        <h3 className="text-title-3">{preview.title}</h3>
        <a
          href={preview.source}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center underline"
        >
          {text("openOriginal")}
        </a>
        <p className="text-subhead">{preview.description}</p>
        <h4 className="font-semibold">{text("ingredients")}</h4>
        <ul className="list-disc ps-5 text-subhead">
          {preview.ingredientLines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
        <details>
          <summary className="min-h-11 cursor-pointer content-center">
            {text("directions")}
          </summary>
          <p className="whitespace-pre-wrap text-subhead">
            {preview.instructions || text("directionsUnavailable")}
          </p>
        </details>
        {recipeImportIssues(preview).length > 0 && (
          <details>
            <summary className="min-h-11 cursor-pointer content-center">
              {text("importReview")}
            </summary>
            <ul className="list-disc ps-5 text-footnote">
              {recipeImportIssues(preview).map((issue) => (
                <li key={issue}>{text(`import_${issue}`)}</li>
              ))}
            </ul>
          </details>
        )}
        {owner.current && ["parent", "teen"].includes(owner.current.role) && (
          <button
            type="button"
            disabled={disabled}
            className="btn-filled min-h-11"
            onClick={() => {
              if (!disabled && !isMutationPending?.()) {
                setEditing(true);
                onEditingChange?.(true);
              }
            }}
          >
            {text("inlineUse")}
          </button>
        )}
      </section>
    );
  return (
    <section className="space-y-3" aria-label={text("findOnline")}>
      <label htmlFor={queryId} className="label-apple">
        {text("searchPrompt")}
      </label>
      <div className="flex gap-2">
        <input
          id={queryId}
          className="input-apple min-w-0 flex-1"
          type="search"
          maxLength={120}
          value={query}
          disabled={disabled}
          placeholder={text("searchPlaceholder")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void read("search");
            }
          }}
        />
        <button
          type="button"
          className="btn-filled min-h-11"
          disabled={locked || query.trim().length < 2}
          onClick={() => void read("search")}
        >
          {text(busy ? "searching" : "inlineSearch")}
        </button>
      </div>
      <p className="text-footnote text-label-secondary">
        {text("inlineSources")}
      </p>
      {query.trim().length >= 2 && (
        <a
          className="inline-flex min-h-11 items-center underline text-subhead"
          href={`https://www.google.com/search?q=${encodeURIComponent(`${query.trim()} recipe`)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {text("inlineGoogle")}
        </a>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer content-center">
          {text("inlinePaste")}
        </summary>
        <label htmlFor={urlId} className="label-apple">
          {text("inlineUrl")}
        </label>
        <div className="flex gap-2">
          <input
            id={urlId}
            type="url"
            value={url}
            maxLength={1500}
            disabled={disabled}
            className="input-apple min-w-0 flex-1"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void read("preview");
              }
            }}
          />
          <button
            type="button"
            className="btn-tinted min-h-11"
            disabled={locked || !url.trim()}
            onClick={() => void read("preview")}
          >
            {text("inlinePreview")}
          </button>
        </div>
      </details>
      {error && (
        <p role="alert" className="text-subhead">
          {error}
        </p>
      )}
      {partial && (
        <p role="status" className="text-footnote">
          {text("inlinePartial")}
        </p>
      )}
      {searched && results.length === 0 && (
        <p role="status">{text("inlineEmpty")}</p>
      )}
      <ul className="space-y-2">
        {results.slice(0, resultLimit).map((result) => (
          <li
            key={result.url}
            className="rounded-xl border border-[var(--surface-separator)] p-3"
          >
            <p className="font-semibold">{result.title}</p>
            <p className="text-footnote text-label-secondary">
              {result.source ?? new URL(result.url).hostname}
            </p>
            <button
              type="button"
              className="btn-plain min-h-11"
              disabled={locked}
              onClick={() => void read("preview", result.url)}
            >
              {text("inlinePreview")}
            </button>
          </li>
        ))}
      </ul>
      {resultLimit < results.length && (
        <button
          type="button"
          className="btn-plain min-h-11"
          disabled={locked}
          onClick={() => setResultLimit((n) => n + 6)}
        >
          {text("inlineMore")}
        </button>
      )}
    </section>
  );
}
