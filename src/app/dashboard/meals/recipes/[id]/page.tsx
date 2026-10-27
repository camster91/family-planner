"use client";

/**
 * Recipe detail route (ADR-0007, #252). Reads `GET /api/recipes/[id]`, which is
 * household-scoped: another household's id is the same 404 as a missing one.
 * Like /dashboard/meals, parents and teens (O-37) open it; children do not
 * (src/lib/kid-access.ts). The recipes API itself allows every role to read.
 * Parent/teen edits use the canonical recipe PATCH; no deletion UI.
 */
import * as React from "react";
import { MealContextLink as Link } from "@/components/meals/MealContextLink";
import { useParams } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { FeatureGate } from "@/components/ui/feature-gate";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/Skeleton";
import { type RecipeDetailData } from "@/components/meals/RecipeDetail";
import { RecipeCookingView } from "@/components/meals/RecipeCookingView";
import { AddToGroceriesButton } from "@/components/meals/AddToGroceriesButton";
import { RecipeDetailEdit } from "@/components/meals/RecipeDetailEdit";
import { useRecipeDetailText } from "@/i18n/recipe-detail";
import { RecipeCuration } from "@/components/meals/RecipeCuration";
import { readRecipeDetail, RecipeDetailNotFound, RecipeDetailOwnerChanged } from "@/lib/recipe-detail-client";
import type { RecipeOwner } from "@/lib/recipe-owner-contract";

type Load =
  | { state: "loading" }
  | { state: "ready"; recipe: RecipeDetailData }
  | { state: "not-found" }
  | { state: "error" }
  | { state: "owner-hold" };

export default function RecipePage() {
  return (
    <FeatureGate featureKey="meals">
      <RecipePageInner />
    </FeatureGate>
  );
}

function RecipePageInner() {
  const detailText = useRecipeDetailText();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const owner = React.useRef<RecipeOwner | null>(null);
  const ownerHeld = React.useRef(false);
  const role = owner.current?.role ?? null;
  const [groceryPending, setGroceryPending] = React.useState(false);
  const groceryPendingRef = React.useRef(false);
  const groceryOwnership = React.useCallback((pending: boolean) => {
    groceryPendingRef.current = pending;
    setGroceryPending(pending);
  }, []);
  const guardGrocery = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (groceryPendingRef.current) event.preventDefault();
  };

  const [load, setLoad] = React.useState<Load>({ state: "loading" });

  const currentId = React.useRef(id);
  currentId.current = id;
  const generation = React.useRef(0);
  const activeRead = React.useRef<AbortController | null>(null);
  const reloadFocus = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (load.state === "owner-hold" && document.activeElement === document.body)
      reloadFocus.current?.focus();
  }, [load.state]);
  const holdOwner = React.useCallback(() => {
    ownerHeld.current = true;
    generation.current++;
    activeRead.current?.abort();
    activeRead.current = null;
    setLoad({ state: "owner-hold" });
  }, []);
  const fetchRecipe = React.useCallback(async () => {
    if (!id || ownerHeld.current) return;
    const requestGeneration = ++generation.current;
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    const current = () =>
      !controller.signal.aborted && currentId.current === id && generation.current === requestGeneration;
    setLoad({ state: "loading" });
    try {
      const result = await readRecipeDetail(id, controller.signal, { expectedOwner: owner.current ?? undefined });
      if (current()) {
        owner.current ??= Object.freeze({ ...result.owner });
        setLoad({ state: "ready", recipe: result.recipe });
      }
    } catch (cause) {
      if (current() && cause instanceof RecipeDetailOwnerChanged) { holdOwner(); return; }
      if (current()) setLoad({ state: cause instanceof RecipeDetailNotFound ? "not-found" : "error" });
    } finally {
      if (activeRead.current === controller) activeRead.current = null;
    }
  }, [id, holdOwner]);

  const invalidateRequests = React.useCallback(() => {
    generation.current++;
    activeRead.current?.abort();
    activeRead.current = null;
  }, []);
  React.useEffect(() => {
    void fetchRecipe();
    return invalidateRequests;
  }, [fetchRecipe, invalidateRequests]);

  // Capture the generation in the rendered save callback, not when it settles.
  const readyGeneration = generation.current;
  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <Link
        href="/dashboard/meals"
        className="inline-flex min-h-[44px] items-center gap-1 text-subhead text-[var(--accent-text)]"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>{detailText("meals")}</span>
      </Link>

      {load.state === "owner-hold" && (
        <section role="alert" className="card-apple p-5 space-y-3">
          <h1 className="text-title-2 text-label-primary">{detailText("ownerChanged")}</h1>
          <p className="text-body text-label-secondary">{detailText("ownerChangedDescription")}</p>
          <button ref={reloadFocus} type="button" className="btn-tinted min-h-[44px]" onClick={() => window.location.reload()}>
            {detailText("reload")}
          </button>
        </section>
      )}

      {load.state === "loading" && (
        <div className="space-y-4" role="status" aria-label={detailText("loading")}>
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <div className="card-apple p-4 space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      )}

      {load.state === "not-found" && (
        <EmptyState
          icon={BookOpen}
          glyphColor="meals"
          headingLevel="h1"
          title={detailText("notFound")}
          description={detailText("notFoundDescription")}
          action={
            <Link href="/dashboard/meals" className="btn-tinted min-h-[44px]">
              {detailText("back")}
            </Link>
          }
        />
      )}

      {load.state === "error" && (
        <EmptyState
          icon={BookOpen}
          glyphColor="meals"
          headingLevel="h1"
          title={detailText("failed")}
          description={detailText("failedDescription")}
          action={
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              onClick={() => void fetchRecipe()}
            >
              {detailText("retry")}
            </button>
          }
        />
      )}

      {load.state === "ready" && (
        <RecipeCookingView
          key={load.recipe.id}
          recipe={load.recipe}
          disabled={groceryPending}
          actions={(servings) => (
            <div className="flex flex-wrap gap-2">
              {(role === "parent" || role === "teen") && (
                <>
                  <Link
                    href={`/dashboard/inventory?cookRecipe=${encodeURIComponent(load.recipe.id)}${servings ? `&portions=${servings}` : ""}`}
                    onClick={guardGrocery}
                    aria-disabled={groceryPending}
                    className="btn-tinted min-h-[44px]"
                  >
                    {detailText("reviewUsed")}
                  </Link>
                  <Link
                    href={`/dashboard/meals?recipe=${encodeURIComponent(load.recipe.id)}`}
                    onClick={guardGrocery}
                    aria-disabled={groceryPending}
                    className="btn-filled min-h-[44px]"
                  >
                    {detailText("planMeal")}
                  </Link>
                  <Link
                    href={`/dashboard/meals?view=bulk&recipe=${encodeURIComponent(load.recipe.id)}`}
                    onClick={guardGrocery}
                    aria-disabled={groceryPending}
                    className="btn-tinted min-h-[44px]"
                  >
                    {detailText("addPrep")}
                  </Link>
                </>
              )}
              <fieldset
                disabled={groceryPending}
                className="min-w-0 flex flex-wrap gap-2"
              >
                <RecipeDetailEdit
                  key={load.recipe.id}
                  recipe={load.recipe}
                  role={role}
                  expectedOwner={owner.current ?? undefined}
                  onOwnerHold={holdOwner}
                  onSaved={(recipe) => {
                    if (
                      currentId.current === id &&
                      recipe.id === id &&
                      generation.current === readyGeneration
                    ) {
                      generation.current++;
                      setLoad({ state: "ready", recipe });
                    }
                  }}
                />
                {(role === "parent" || role === "teen") && (
                  <RecipeCuration
                    id={load.recipe.id}
                    title={load.recipe.title}
                    favorite={load.recipe.favorite}
                    expectedOwner={owner.current ?? undefined}
                    onOwnerHold={holdOwner}
                    onChanged={() => void fetchRecipe()}
                  />
                )}
              </fieldset>
              {load.recipe.ingredients.length > 0 && (
                <AddToGroceriesButton
                  recipeId={load.recipe.id}
                  servings={servings}
                  onPendingChange={groceryOwnership}
                />
              )}
            </div>
          )}
        />
      )}
    </div>
  );
}
