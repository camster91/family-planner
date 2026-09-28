'use client'

/**
 * Recipe detail route (ADR-0007, #252). Reads `GET /api/recipes/[id]`, which is
 * household-scoped: another household's id is the same 404 as a missing one.
 * Like /dashboard/meals, this page is parent-only in the UI (kid allowlist,
 * src/lib/kid-access.ts); the recipes API itself allows every role to read.
 */
import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { FeatureGate } from '@/components/ui/feature-gate'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/Skeleton'
import { RecipeDetail, type RecipeDetailData } from '@/components/meals/RecipeDetail'

type Load = { state: 'loading' } | { state: 'ready'; recipe: RecipeDetailData } | { state: 'not-found' } | { state: 'error' }

export default function RecipePage() {
  return (
    <FeatureGate featureKey="meals">
      <RecipePageInner />
    </FeatureGate>
  )
}

function RecipePageInner() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [load, setLoad] = React.useState<Load>({ state: 'loading' })

  const fetchRecipe = React.useCallback(async () => {
    if (!id) return
    setLoad({ state: 'loading' })
    try {
      const res = await fetch(`/api/recipes/${encodeURIComponent(id)}`)
      if (res.status === 404) {
        setLoad({ state: 'not-found' })
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { recipe: RecipeDetailData }
      setLoad({ state: 'ready', recipe: data.recipe })
    } catch {
      setLoad({ state: 'error' })
    }
  }, [id])

  React.useEffect(() => {
    void fetchRecipe()
  }, [fetchRecipe])

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <Link
        href="/dashboard/meals"
        className="inline-flex min-h-[44px] items-center gap-1 text-subhead text-[var(--accent-text)]"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        <span>Meals</span>
      </Link>

      {load.state === 'loading' && (
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

      {load.state === 'not-found' && (
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

      {load.state === 'error' && (
        <EmptyState
          icon={BookOpen}
          glyphColor="meals"
          headingLevel="h1"
          title="Couldn’t load this recipe"
          description="Check your connection and try again."
          action={
            <button type="button" className="btn-tinted min-h-[44px]" onClick={() => void fetchRecipe()}>
              Try again
            </button>
          }
        />
      )}

      {load.state === 'ready' && (
        <RecipeDetail
          recipe={load.recipe}
          actions={
            // #253 mounts its "Add to groceries" control here (AddToGroceriesButton,
            // POST /api/lists/items/from-recipe). Deliberately empty in #252.
            null
          }
        />
      )}
    </div>
  )
}
