'use client'

/**
 * Household search page (route inventory F-3). Typing waits a moment, then
 * asks `GET /api/search`; results come back grouped by kind, each a link to
 * the page that holds it. States: nothing typed, too short, searching, no
 * matches, could not search (with Try again) and offline (nothing is sent).
 * Keyboard: Down from the box moves into the results, Up/Down move between
 * them, Up from the first one returns to the box, Escape clears the box.
 */
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Search, WifiOff, X } from 'lucide-react'
import { useOnline } from '@/components/ui/use-online'
import { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH, type SearchResult } from '@/lib/household-search'
import { SEARCH_RESULT_TYPES, type SearchResultType } from '@/lib/search-result-href'
import { cn } from '@/lib/utils'

export const SEARCH_DEBOUNCE_MS = 250

const GROUP_LABEL: Record<SearchResultType, string> = {
  member: 'People',
  event: 'Events',
  chore: 'Chores',
  list: 'Lists',
  list_item: 'On a list',
  recipe: 'Recipes',
  note: 'Notes',
  inventory: 'Food at home',
}

type Status =
  | { kind: 'idle' }
  | { kind: 'short' }
  | { kind: 'loading' }
  | { kind: 'done'; query: string; results: SearchResult[] }
  | { kind: 'error'; message: string }

function cleanQuery(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ')
}

function formatWhen(result: SearchResult): string | null {
  if (!result.date) return null
  const date = new Date(result.date)
  if (Number.isNaN(date.getTime())) return null
  if (result.type === 'event') {
    return date.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  }
  return `Due ${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`
}

export default function SearchClient({ initialQuery = '' }: { initialQuery?: string }) {
  const [query, setQuery] = React.useState(initialQuery)
  const [status, setStatus] = React.useState<Status>({ kind: 'idle' })
  const [attempt, setAttempt] = React.useState(0)
  const online = useOnline()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const resultsRef = React.useRef<HTMLDivElement>(null)
  const inputId = React.useId()

  const q = cleanQuery(query)
  const tooShort = q.length > 0 && Array.from(q).length < SEARCH_MIN_LENGTH

  // Keep ?q= in the address bar so a search can be shared, reloaded or reached from the command palette.
  React.useEffect(() => {
    const url = new URL(window.location.href)
    if (q) url.searchParams.set('q', q)
    else url.searchParams.delete('q')
    window.history.replaceState(window.history.state, '', url.pathname + url.search)
  }, [q])

  // A navigation to /dashboard/search?q=… while this page is open (the command
  // palette, or the top-bar link with no q) keeps this component mounted, so
  // follow the address bar when it no longer matches the box. useSearchParams
  // is only the trigger: it can lag behind the replaceState above while typing,
  // so compare against the live address, which that effect has already written.
  const urlQuery = useSearchParams()?.get('q') ?? ''
  const qRef = React.useRef(q)
  React.useEffect(() => {
    qRef.current = q
  }, [q])
  React.useEffect(() => {
    const live = (new URL(window.location.href).searchParams.get('q') ?? '').slice(0, 100)
    if (cleanQuery(live) !== qRef.current) setQuery(live)
  }, [urlQuery])

  React.useEffect(() => {
    if (!q) {
      setStatus({ kind: 'idle' })
      return
    }
    if (tooShort) {
      setStatus({ kind: 'short' })
      return
    }
    if (!online) return
    const controller = new AbortController()
    setStatus({ kind: 'loading' })
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        const body = await res.json().catch(() => null)
        if (controller.signal.aborted) return
        if (!res.ok) {
          setStatus({
            kind: 'error',
            message:
              res.status === 400 && body?.error ? String(body.error) : "Search didn't work. Check your connection and try again.",
          })
          return
        }
        setStatus({ kind: 'done', query: q, results: Array.isArray(body?.results) ? body.results : [] })
      } catch {
        if (controller.signal.aborted) return
        setStatus({ kind: 'error', message: "Search didn't work. Check your connection and try again." })
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [q, tooShort, online, attempt])

  const resultLinks = () =>
    Array.from(resultsRef.current?.querySelectorAll<HTMLAnchorElement>('a[data-search-result]') ?? [])

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      const first = resultLinks()[0]
      if (first) {
        e.preventDefault()
        first.focus()
      }
    } else if (e.key === 'Escape' && query) {
      e.preventDefault()
      setQuery('')
    }
  }

  function onResultsKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const links = resultLinks()
    const index = links.indexOf(document.activeElement as HTMLAnchorElement)
    if (index === -1) return
    e.preventDefault()
    if (e.key === 'ArrowDown') links[Math.min(index + 1, links.length - 1)].focus()
    else if (index === 0) inputRef.current?.focus()
    else links[index - 1].focus()
  }

  const results = status.kind === 'done' ? status.results : []
  const groups = SEARCH_RESULT_TYPES.map((type) => ({ type, items: results.filter((r) => r.type === type) })).filter(
    (g) => g.items.length > 0
  )

  let announcement = ''
  if (!online && q && !tooShort) announcement = "You're offline. Search needs a connection."
  else if (status.kind === 'loading') announcement = 'Searching…'
  else if (status.kind === 'done') {
    announcement =
      status.results.length === 0
        ? `Nothing matches “${status.query}”.`
        : `${status.results.length} ${status.results.length === 1 ? 'result' : 'results'} for “${status.query}”.`
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-large-title font-display">Search</h1>
        <p className="text-subhead text-label-secondary mt-0.5">
          Find people, events, chores, lists, recipes, notes and food at home.
        </p>
      </div>

      <div role="search" aria-label="Search your household" className="relative">
        <label htmlFor={inputId} className="sr-only">
          Search your household
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-label-tertiary"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          maxLength={SEARCH_MAX_LENGTH}
          autoComplete="off"
          autoFocus
          enterKeyHint="search"
          placeholder="Search your household"
          aria-describedby={`${inputId}-status`}
          className="no-native-clear w-full input-apple min-h-[44px] pl-9 pr-12"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full text-label-tertiary"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <p id={`${inputId}-status`} role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {!q && (
        <div className="card-apple p-8 text-center flex flex-col items-center" data-testid="search-idle">
          <div className="w-16 h-16 rounded-full bg-[var(--surface-fill)] flex items-center justify-center mb-4">
            <Search className="w-7 h-7 text-label-tertiary" aria-hidden="true" />
          </div>
          <h2 className="text-title-3 text-label-primary mb-1">Search everything at home</h2>
          <p className="text-subhead text-label-secondary max-w-xs">
            Type a name, a chore, a list item or a recipe. Only your household is searched.
          </p>
        </div>
      )}

      {tooShort && (
        <p className="text-subhead text-label-secondary text-center" data-testid="search-short">
          Keep typing. Search starts at {SEARCH_MIN_LENGTH} letters.
        </p>
      )}

      {q && !tooShort && !online && (
        <div className="card-apple p-6 text-center flex flex-col items-center gap-2" data-testid="search-offline">
          <WifiOff className="w-6 h-6 text-label-tertiary" aria-hidden="true" />
          <p className="text-subhead text-label-secondary">You&apos;re offline. Search needs a connection.</p>
        </div>
      )}

      {online && status.kind === 'loading' && (
        <p className="text-subhead text-label-secondary text-center" data-testid="search-loading" aria-hidden="true">
          Searching…
        </p>
      )}

      {online && status.kind === 'error' && (
        <div className="card-apple p-6 text-center flex flex-col items-center gap-3" data-testid="search-error">
          <p className="text-subhead text-label-secondary" role="alert">
            {status.message}
          </p>
          <button type="button" className="btn-tinted min-h-[44px]" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}

      {online && status.kind === 'done' && status.results.length === 0 && (
        <div className="card-apple p-8 text-center" data-testid="search-empty">
          <Search className="w-8 h-8 text-label-tertiary mx-auto mb-3" aria-hidden="true" />
          <p className="text-subhead text-label-secondary">Nothing matches &ldquo;{status.query}&rdquo;.</p>
          <p className="text-footnote text-label-tertiary mt-1">Try a shorter word or check the spelling.</p>
        </div>
      )}

      {online && groups.length > 0 && (
        <div ref={resultsRef} onKeyDown={onResultsKeyDown} className="space-y-5" data-testid="search-results">
          {groups.map((group) => (
            <section key={group.type} aria-labelledby={`${inputId}-${group.type}`}>
              <h2 id={`${inputId}-${group.type}`} className="section-header px-1 pb-1">
                {GROUP_LABEL[group.type]}
              </h2>
              <ul className="list-inset">
                {group.items.map((result) => {
                  const when = formatWhen(result)
                  const detail = [result.subtitle, when].filter(Boolean).join(' · ')
                  return (
                    <li key={`${result.type}:${result.id}`} className="border-b border-[var(--surface-separator)] last:border-b-0">
                      <Link
                        href={result.href}
                        data-search-result
                        className={cn(
                          'row-apple w-full text-left',
                          'focus-visible:shadow-[var(--shadow-focus)] focus-visible:rounded-[var(--radius-md)]'
                        )}
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block text-body text-label-primary break-words">{result.title}</span>
                          {detail && <span className="block text-footnote text-label-secondary break-words">{detail}</span>}
                        </span>
                        <ChevronRight className="w-4 h-4 text-label-tertiary shrink-0" aria-hidden="true" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
