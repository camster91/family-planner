"use client"

import * as React from 'react'
import Link from 'next/link'
import { FeatureGate } from '@/components/ui/feature-gate'
import { Dialog } from '@/components/ui/dialog'
import { RecipeEditor } from '@/components/meals/RecipeEditor'
import { publicRecipeUrl, recipeSources, type OnlineRecipe } from '@/lib/recipe-discovery'

type SavedRecipe = { id: string; title: string; description: string | null }

export default function RecipeExplorePage() {
  const [query, setQuery] = React.useState('')
  const [source, setSource] = React.useState<string>(recipeSources[0].name)
  const [resultLimit, setResultLimit] = React.useState(6)
  const [results, setResults] = React.useState<Array<{ title: string; url: string }>>([])
  const [searching, setSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState('')
  const [searched, setSearched] = React.useState(false)
  const searchController = React.useRef<AbortController | null>(null)
  const [url, setUrl] = React.useState('')
  const [recipes, setRecipes] = React.useState<SavedRecipe[]>([])
  const [offset, setOffset] = React.useState<number | null>(0)
  const [loadingLibrary, setLoadingLibrary] = React.useState(false)
  const [libraryError, setLibraryError] = React.useState('')
  const [canSave, setCanSave] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [preview, setPreview] = React.useState<OnlineRecipe | null>(null)
  const [editor, setEditor] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [embedded, setEmbedded] = React.useState(false)
  const [savedId, setSavedId] = React.useState<string | null>(null)
  const libraryBusy = React.useRef(false)
  const importBusy = React.useRef(false)
  const controller = React.useRef<AbortController | null>(null)
  const libraryController = React.useRef<AbortController | null>(null)

  const loadLibrary = React.useCallback(async (next: number) => {
    if (libraryBusy.current) return
    libraryBusy.current = true
    const abort = new AbortController()
    libraryController.current = abort
    setLoadingLibrary(true); setLibraryError('')
    try {
      const response = await fetch(`/api/recipes?limit=100&offset=${next}`, { signal: abort.signal })
      const data = await response.json()
      if (!response.ok) throw new Error('Could not load saved recipes. Try again.')
      if (!abort.signal.aborted) {
        setRecipes(previous => next === 0 ? data.recipes : [...previous, ...data.recipes])
        setOffset(data.nextOffset)
      }
    } catch (err) { if (!abort.signal.aborted) setLibraryError(err instanceof Error ? err.message : 'Could not load saved recipes.') }
    finally { if (!abort.signal.aborted) { libraryBusy.current = false; setLoadingLibrary(false) } }
  }, [])

  React.useEffect(() => {
    const abort = new AbortController()
    fetch('/api/auth/me', { signal: abort.signal }).then(r => r.ok ? r.json() : null).then(data => {
      if (!abort.signal.aborted) setCanSave(['parent', 'teen'].includes(data?.user?.role))
    }).catch(() => undefined)
    void loadLibrary(0)
    return () => { abort.abort(); controller.current?.abort(); searchController.current?.abort(); libraryController.current?.abort(); libraryBusy.current = false }
  }, [loadLibrary])

  const readRecipe = async (event?: React.FormEvent, selectedUrl = url) => {
    event?.preventDefault()
    if (!canSave || importBusy.current) return
    const link = publicRecipeUrl(selectedUrl.trim())
    if (!link) { setError('Paste a public HTTPS recipe link.'); return }
    importBusy.current = true; setLoading(true); setError('')
    const abort = new AbortController(); controller.current = abort
    try {
      const response = await fetch('/api/recipes/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: link }), signal: abort.signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not read this recipe.')
      if (!abort.signal.aborted) { setPreview(data.recipe); setEditor(false); setEmbedded(false); setSavedId(null) }
    } catch (err) { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'Could not read this recipe.') }
    finally { if (!abort.signal.aborted) { importBusy.current = false; setLoading(false) } }
  }
  const searchOnline = async (event: React.FormEvent) => {
    event.preventDefault()
    searchController.current?.abort()
    const abort = new AbortController(); searchController.current = abort
    setSearching(true); setSearchError(''); setResults([]); setResultLimit(6); setSearched(false)
    try {
      const response = await fetch('/api/recipes/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: query.trim(), source }), signal: abort.signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not search this source.')
      if (!abort.signal.aborted) { setResults(data.results); setSearched(true) }
    } catch (error) { if (!abort.signal.aborted) setSearchError(error instanceof Error ? error.message : 'Could not search this source.') }
    finally { if (!abort.signal.aborted) setSearching(false) }
  }
  const visible = recipes.filter(recipe => `${recipe.title} ${recipe.description || ''}`.toLowerCase().includes(query.toLowerCase()))
  const existing = preview ? recipes.find(recipe => recipe.description?.startsWith(`Source: ${preview.source}\n`)) : undefined

  return <FeatureGate featureKey="meals"><div className="space-y-6 pb-20">
    <header><Link href="/dashboard/meals" className="btn-plain min-h-[44px]">← Meals</Link><h1 className="text-large-title font-display">Explore recipes</h1><p className="text-subhead text-label-secondary">Find something to cook. Keep your favourites in your household recipe box.</p></header>
    <section className="card-apple p-4 space-y-3" aria-labelledby="recipe-discovery-title">
      <h2 id="recipe-discovery-title" className="text-title-3">Find online</h2>
      <form onSubmit={searchOnline} className="space-y-3"><label className="label-apple" htmlFor="recipeSearch">What would you like to cook?</label>
      <input id="recipeSearch" className="input-apple" value={query} onChange={e => setQuery(e.target.value)} placeholder="Chicken, pasta, quick dinners…" maxLength={120} minLength={2} required />
      <div className="flex flex-wrap gap-3 items-end"><div className="flex-1 min-w-[180px] sm:max-w-sm"><label className="label-apple" htmlFor="recipeSource">Source</label><select id="recipeSource" className="input-apple min-h-[44px]" value={source} onChange={e => setSource(e.target.value)}>{recipeSources.map(source => <option key={source.name}>{source.name}</option>)}</select></div><button type="submit" className="btn-filled min-h-[44px]" disabled={searching}>{searching ? 'Searching…' : 'Search recipes'}</button></div></form>
      {searchError && <p role="alert" className="text-[var(--danger-text)]">{searchError}</p>}
      {searched && results.length === 0 && <p role="status" className="text-label-secondary">No recipe links were available here. Try the source search below.</p>}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{results.slice(0, resultLimit).map(result => <li key={result.url} className="rounded-xl border border-[var(--surface-separator)] p-3 min-w-0"><p className="text-headline break-words">{result.title}</p><p className="text-footnote text-label-secondary">{new URL(result.url).hostname}</p><div className="flex flex-wrap gap-2 mt-2">{canSave && <button className="btn-tinted min-h-[44px]" disabled={loading} onClick={() => { setUrl(result.url); void readRecipe(undefined, result.url) }}>Read recipe</button>}<a href={result.url} target="_blank" rel="noopener noreferrer" className="btn-plain min-h-[44px]">Open original ↗</a></div></li>)}</ul>
      {results.length > resultLimit && <button className="btn-tinted min-h-[44px]" onClick={() => setResultLimit(previous => previous + 6)}>Show more recipes</button>}
      <div className="flex flex-wrap gap-2">{recipeSources.map(source => <a key={source.name} href={`${source.search}${encodeURIComponent(query.trim())}`} target="_blank" rel="noopener noreferrer" className="btn-tinted min-h-[44px]">Search {source.name} ↗</a>)}</div>
      <p className="text-footnote text-label-secondary">You can also search directly on these sites. Copy any recipe link below to read and save it here.</p>
    </section>
    {canSave && <section className="card-apple p-4" aria-labelledby="import-title">
      <h2 id="import-title" className="text-title-3 mb-3">Save from a link</h2>
      <form onSubmit={event => void readRecipe(event)} className="flex flex-wrap gap-3"><div className="flex-1 min-w-0 basis-64"><label className="label-apple" htmlFor="recipeUrl">Recipe link</label><input id="recipeUrl" type="url" required className="input-apple" value={url} disabled={loading} maxLength={1500} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></div><button className="btn-filled min-h-[44px] self-end" disabled={loading} type="submit">{loading ? 'Reading…' : 'Read recipe'}</button></form>
      {error && <div className="mt-3"><p role="alert" className="text-[var(--danger-text)]">{error}</p>{publicRecipeUrl(url.trim()) && <a className="btn-tinted min-h-[44px] mt-2" href={publicRecipeUrl(url.trim())!} target="_blank" rel="noopener noreferrer">Open original ↗</a>}</div>}
    </section>}
    <section aria-labelledby="saved-title"><h2 id="saved-title" className="text-title-2 mb-3">Your recipe box</h2>
      {libraryError && <div role="alert"><p>{libraryError}</p><button className="btn-tinted" onClick={() => void loadLibrary(offset ?? 0)}>Try again</button></div>}
      {loadingLibrary && <p role="status">Loading recipes…</p>}
      {!loadingLibrary && !libraryError && visible.length === 0 && <p className="text-label-secondary">{query ? 'No saved recipes match this search.' : 'Save a recipe from a link, or add one while planning a meal.'}</p>}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visible.map(recipe => <li key={recipe.id} className="card-apple p-4 min-w-0"><Link href={`/dashboard/meals/recipes/${recipe.id}`} className="inline-flex min-h-[44px] items-center text-headline break-words">{recipe.title}</Link><p className="text-footnote text-label-secondary">Ready to use when adding a meal</p></li>)}</ul>
      {offset !== null && !loadingLibrary && recipes.length > 0 && <button className="btn-tinted mt-3" onClick={() => void loadLibrary(offset)}>Load more recipes</button>}
    </section>
    {preview && <Dialog open title={preview.title} variant="form" onClose={saving ? undefined : () => { setPreview(null); setEditor(false) }} closeLabel="Close recipe">
      {editor ? <><p className="text-footnote text-label-secondary mb-3">Review before saving. Original ingredient quantities are kept in the directions; add ingredient rows below to use the grocery tools.</p><RecipeEditor initialDraft={{ servings: preview.servings, title: preview.title, description: `Source: ${preview.source}\n${preview.description}`, instructions: `${preview.ingredientLines.length ? `Ingredients\n${preview.ingredientLines.join('\n')}\n\n` : ''}${preview.instructions}`.slice(0, 20000), prep_time: preview.prep_time, cook_time: preview.cook_time }} onSavingChange={setSaving} onCancel={() => setEditor(false)} onCreated={recipe => { setSavedId(recipe.id); setEditor(false); setRecipes(previous => [{ id: recipe.id, title: recipe.title, description: `Source: ${preview.source}\n${preview.description}` }, ...previous]) }} /></> : <div className="space-y-4">
        <div className="flex flex-wrap gap-2"><a href={preview.source} target="_blank" rel="noopener noreferrer" className="btn-tinted min-h-[44px]">Open original ↗</a><button className="btn-tinted min-h-[44px]" onClick={() => setEmbedded(value => !value)}>{embedded ? 'Recipe reader' : 'View original here'}</button>
        {savedId || existing ? <Link href={`/dashboard/meals/recipes/${savedId || existing?.id}`} className="btn-filled">Open saved recipe</Link> : <button className="btn-filled" onClick={() => setEditor(true)}>Review and save</button>}</div>
        <p className="text-footnote text-label-secondary break-all">Source: {new URL(preview.source).hostname}</p>
        {embedded ? <><p className="text-footnote text-label-secondary">Some sites block embedded viewing. Use Open original if the page is blank.</p><iframe title={`Original recipe: ${preview.title}`} src={preview.source} sandbox="allow-scripts" referrerPolicy="no-referrer" className="w-full h-[60dvh] rounded-xl border border-[var(--surface-separator)]" /></> : <><p className="text-body whitespace-pre-line">{preview.description}</p><h3 className="text-headline">Ingredients</h3><ul className="space-y-2">{preview.ingredientLines.map((line, index) => <li key={index} className="text-body break-words">{line}</li>)}</ul><h3 className="text-headline">Directions</h3><p className="text-body whitespace-pre-line break-words">{preview.instructions || 'Directions were not available. Open the original recipe.'}</p></>}
      </div>}
    </Dialog>}
  </div></FeatureGate>
}
