"use client";

/**
 * Recipe detail route (ADR-0007, #252). Reads `GET /api/recipes/[id]`, which is
 * household-scoped: another household's id is the same 404 as a missing one.
 * Like /dashboard/meals, parents and teens (O-37) open it; children do not
 * (src/lib/kid-access.ts). The recipes API itself allows every role to read.
 * Parent/teen edits use the canonical recipe PATCH; no deletion UI.
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { FeatureGate } from "@/components/ui/feature-gate";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  RecipeDetail,
  type RecipeDetailData,
} from "@/components/meals/RecipeDetail";
import { AddToGroceriesButton } from "@/components/meals/AddToGroceriesButton";
import { RecipeDetailEdit } from "@/components/meals/RecipeDetailEdit";

type Load =
  | { state: "loading" }
  | { state: "ready"; recipe: RecipeDetailData }
  | { state: "not-found" }
  | { state: "error" };

export default function RecipePage() {
  return (
    <FeatureGate featureKey="meals">
      <RecipePageInner />
    </FeatureGate>
  );
}

function RecipePageInner() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [role, setRole] = React.useState<string | null>(null);
  React.useEffect(() => {
    let active = true;
    fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (active) setRole(data.user?.role ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const [load, setLoad] = React.useState<Load>({ state: "loading" });

  const currentId = React.useRef(id);
  currentId.current = id;
  const generation = React.useRef(0);
  const fetchRecipe = React.useCallback(async () => {
    if (!id) return;
    const requestGeneration = ++generation.current;
    const current = () =>
      currentId.current === id && generation.current === requestGeneration;
    setLoad({ state: "loading" });
    try {
      const res = await fetch(`/api/recipes/${encodeURIComponent(id)}`);
      if (!current()) return;
      if (res.status === 404) {
        setLoad({ state: "not-found" });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { recipe: RecipeDetailData };
      if (current()) setLoad({ state: "ready", recipe: data.recipe });
    } catch {
      if (current()) setLoad({ state: "error" });
    }
  }, [id]);

  const invalidateRequests = React.useCallback(() => {
    generation.current++;
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
        <span>Meals</span>
      </Link>

      {load.state === "loading" && (
        <div className="space-y-4" role="status" aria-label="Loading recipe">
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
          title="Recipe not found"
          description="It may have been deleted. Meals that used it keep their name."
          action={
            <Link href="/dashboard/meals" className="btn-tinted min-h-[44px]">
              Back to meals
            </Link>
          }
        />
      )}

      {load.state === "error" && (
        <EmptyState
          icon={BookOpen}
          glyphColor="meals"
          headingLevel="h1"
          title="Couldn’t load this recipe"
          description="Check your connection and try again."
          action={
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              onClick={() => void fetchRecipe()}
            >
              Try again
            </button>
          }
        />
      )}

      {load.state === "ready" && (
        <RecipeDetail
          recipe={load.recipe}
          actions={
            <div className="flex flex-wrap gap-2">
              <RecipeDetailEdit
                key={load.recipe.id}
                recipe={load.recipe}
                role={role}
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
              {load.recipe.ingredients.length > 0 && (
                <AddToGroceriesButton recipeId={load.recipe.id} />
              )}
            </div>
          }
        />
      )}
    </div>
  );
}
