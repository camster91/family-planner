'use client'

import * as React from 'react'
import { Plus, MapPin, Home, Briefcase, GraduationCap, Trash2, Pencil } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { FeatureGate } from '@/components/ui/feature-gate'
import { EmptyState } from '@/components/ui/empty-state'
import { InsetList, SectionHeader } from '@/components/ui/list-row'
import { useToast } from '@/components/ui/toast'
import { OFFLINE_MESSAGE, responseErrorMessage } from '@/lib/fetch-error'
import { Dialog } from '@/components/ui/dialog'
import { usePendingFormNavigationController } from '@/components/layout/pending-form-navigation'
import { useTranslation } from '@/i18n'
import { useLocationsText } from '@/i18n/locations'
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from '@/lib/idempotency-key'

interface Location {
  id: string
  label: string
  address?: string | null
  is_primary?: boolean
  user_id: string
  user_name?: string
  user_avatar?: string | null
}

function isLocation(value: unknown): value is Location {
  if (!value || typeof value !== 'object') return false
  const location = value as Record<string, unknown>
  return (
    typeof location.id === 'string' &&
    typeof location.label === 'string' &&
    typeof location.user_id === 'string' &&
    (location.address === undefined || location.address === null || typeof location.address === 'string') &&
    (location.is_primary === undefined || typeof location.is_primary === 'boolean') &&
    (location.user_name === undefined || typeof location.user_name === 'string') &&
    (location.user_avatar === undefined || location.user_avatar === null || typeof location.user_avatar === 'string')
  )
}

function parseLocationsResponse(value: unknown): Location[] | null {
  if (!value || typeof value !== 'object') return null
  const locations = (value as { locations?: unknown }).locations
  return Array.isArray(locations) && locations.every(isLocation) ? locations : null
}

const ICON_FOR_LABEL: Record<string, any> = {
  Home: Home,
  Work: Briefcase,
  School: GraduationCap,
}

export default function LocationsPage() {
  return (
    <FeatureGate featureKey="locations">
      <LocationsPageInner />
    </FeatureGate>
  )
}

function LocationsPageInner() {
  const [locations, setLocations] = React.useState<Location[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(false)
  const [editorTarget, setEditorTarget] = React.useState<Location | 'new' | null>(null)
  const [editorLabel, setEditorLabel] = React.useState('Home')
  const [editorAddress, setEditorAddress] = React.useState('')
  const [editorSaving, setEditorSaving] = React.useState(false)
  const [editorError, setEditorError] = React.useState<'failed' | 'network' | null>(null)
  const [removeTarget, setRemoveTarget] = React.useState<Location | null>(null)
  const [removing, setRemoving] = React.useState(false)
  const [removeError, setRemoveError] = React.useState<'failed' | 'network' | null>(null)
  const addButtonRef = React.useRef<HTMLButtonElement>(null)
  const editorLabelRef = React.useRef<HTMLInputElement>(null)
  const cancelRemoveRef = React.useRef<HTMLButtonElement>(null)
  const removingRef = React.useRef(false)
  const loadGenerationRef = React.useRef(0)
  const createRequestRef = React.useRef<{ payload: string; key: string } | null>(null)
  const { t } = useTranslation()
  const locationText = useLocationsText()
  const locationTextRef = React.useRef(locationText)
  locationTextRef.current = locationText
  usePendingFormNavigationController(editorSaving || removing)

  // KidHome pattern: a refused or failed request says so in a toast instead
  // of doing nothing (or leaving an unhandled rejection when offline).
  const { addToast } = useToast()
  const failed = React.useCallback(
    async (title: string, res?: Response) => {
      addToast({ type: 'error', title, message: res ? await responseErrorMessage(res) : OFFLINE_MESSAGE })
    },
    [addToast]
  )

  const load = React.useCallback(async () => {
    const generation = ++loadGenerationRef.current
    setLoading(true)
    try {
      const res = await fetch('/api/locations', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        const nextLocations = parseLocationsResponse(data)
        if (!nextLocations) {
          if (generation !== loadGenerationRef.current) return
          setLoadError(true)
          return
        }
        if (generation !== loadGenerationRef.current) return
        setLocations(nextLocations)
        setLoadError(false)
      } else {
        if (generation !== loadGenerationRef.current) return
        setLoadError(true)
        await failed(locationTextRef.current('loadToastTitle'), res)
      }
    } catch {
      if (generation !== loadGenerationRef.current) return
      setLoadError(true)
      await failed(locationTextRef.current('loadToastTitle'))
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false)
    }
  }, [failed])

  React.useEffect(() => {
    load()
  }, [load])

  const openEditor = (location?: Location) => {
    // Each opened editor is a new intent. A failed create keeps its key in
    // createRequestRef so an unchanged retry replays the same server receipt.
    createRequestRef.current = null
    setEditorTarget(location ?? 'new')
    setEditorLabel(location?.label ?? 'Home')
    setEditorAddress(location?.address ?? '')
    setEditorError(null)
  }

  const closeEditor = () => {
    if (editorSaving) return
    createRequestRef.current = null
    setEditorTarget(null)
    setEditorError(null)
  }

  async function saveEditor(e: React.FormEvent) {
    e.preventDefault()
    const label = editorLabel.trim()
    if (!label || !editorTarget || editorSaving) return
    setEditorSaving(true)
    setEditorError(null)
    const expectedId = editorTarget === 'new' ? null : editorTarget.id
    const path = expectedId ? `/api/locations/${encodeURIComponent(expectedId)}` : '/api/locations'
    const body = { label, address: editorAddress.trim() || null }
    let idempotencyKey: string | null = null
    if (!expectedId) {
      const payload = JSON.stringify(body)
      const previous = createRequestRef.current
      idempotencyKey = previous?.payload === payload ? previous.key : newIdempotencyKey()
      createRequestRef.current = { payload, key: idempotencyKey }
    }
    try {
      const res = await fetch(path, {
        method: expectedId ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { [IDEMPOTENCY_HEADER]: idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        if (!data || typeof data.location?.id !== 'string' || (expectedId && data.location.id !== expectedId)) {
          setEditorError('failed')
          await failed(locationText('saveToastTitle'))
          return
        }
        createRequestRef.current = null
        setEditorTarget(null)
        void load()
      } else {
        setEditorError('failed')
        await failed(locationText('saveToastTitle'), res)
      }
    } catch {
      setEditorError('network')
      await failed(locationText('saveToastTitle'))
    } finally {
      setEditorSaving(false)
    }
  }

  const openRemoveConfirmation = (location: Location) => {
    if (removingRef.current) return
    setRemoveError(null)
    setRemoveTarget(location)
  }

  const closeRemoveConfirmation = () => {
    if (removingRef.current) return
    setRemoveError(null)
    setRemoveTarget(null)
  }

  const remove = React.useCallback(async () => {
    const location = removeTarget
    if (!location || removingRef.current) return
    removingRef.current = true
    setRemoving(true)
    setRemoveError(null)
    try {
      const res = await fetch(`/api/locations/${encodeURIComponent(location.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        setRemoveError('failed')
        return
      }
      setRemoveTarget(null)
      // Wait for the post-delete read before restoring focus. The dialog's
      // unmount cleanup restores its opener; scheduling focus before that
      // refresh can let a stale trigger restoration win on slower desktops.
      await load()
      window.requestAnimationFrame(() => (addButtonRef.current ?? editorLabelRef.current)?.focus())
    } catch {
      setRemoveError('network')
    } finally {
      removingRef.current = false
      setRemoving(false)
    }
  }, [load, removeTarget])

  const primary = locations.filter((l) => l.is_primary)
  const others = locations.filter((l) => !l.is_primary)

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <LargeHeader
        greeting={locationText('greeting')}
        title={locationText('pageTitle')}
        subtitle={locationText('pageSubtitle')}
        trailing={
          <button
            type="button"
            onClick={() => openEditor()}
            className="btn-tinted min-h-[44px] min-w-[44px]"
            ref={addButtonRef}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>{locationText('add')}</span>
          </button>
        }
      />

      {loadError && !loading && (
        <div data-testid="locations-load-error" role="alert" className="card-apple flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-body font-semibold text-label-primary">{locationText('loadErrorTitle')}</p>
            <p className="text-footnote text-label-secondary">{locationText('loadErrorDescription')}</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="btn-tinted min-h-[44px] min-w-[44px]"
          >
            {loading ? locationText('refreshing') : locationText('retry')}
          </button>
        </div>
      )}

      {loading && locations.length === 0 ? (
        <div className="list-inset">
          {[1, 2, 3].map((i) => (
            <div key={i} className="row-apple border-b border-[var(--surface-separator)] last:border-b-0">
              <div className="glyph bg-surface-fill shimmer" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 rounded-full shimmer" />
                <div className="h-2.5 w-48 rounded-full shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : !loadError && locations.length === 0 ? (
        <EmptyState
          icon={MapPin}
          glyphColor="calendar"
          title={locationText('emptyTitle')}
          description={locationText('emptyDescription')}
        />
      ) : (
        <>
          {primary.length > 0 && (
            <section>
              <SectionHeader>{locationText('primarySection')}</SectionHeader>
              <InsetList>
                {primary.map((l, i) => (
                  <LocationRow
                    key={l.id}
                    location={l}
                    onEdit={openEditor}
                    onRemove={openRemoveConfirmation}
                    last={i === primary.length - 1}
                  />
                ))}
              </InsetList>
            </section>
          )}
          {others.length > 0 && (
            <section>
              <SectionHeader>{locationText('otherSection')}</SectionHeader>
              <InsetList>
                {others.map((l, i) => (
                  <LocationRow
                    key={l.id}
                    location={l}
                    onEdit={openEditor}
                    onRemove={openRemoveConfirmation}
                    last={i === others.length - 1}
                  />
                ))}
              </InsetList>
            </section>
          )}
        </>
      )}

      {removeTarget && (
        <Dialog
          open
          role="alertdialog"
          testId="remove-location-dialog"
          title={locationText('removeTitle', { label: removeTarget.label })}
          description={locationText('removeDescription', { label: removeTarget.label })}
          initialFocusRef={cancelRemoveRef}
          onClose={removing ? undefined : closeRemoveConfirmation}
          closeLabel={locationText('removeClose')}
        >
          <div aria-busy={removing}>
            {removeError && (
              <p role="alert" className="mb-4 text-sm text-danger-text">
                {removeError === 'network'
                  ? locationText('removeNetworkError')
                  : locationText('removeFailed')}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                ref={cancelRemoveRef}
                type="button"
                disabled={removing}
                onClick={closeRemoveConfirmation}
                className="min-h-[44px] min-w-[44px] rounded-lg border border-input px-4 text-foreground disabled:opacity-60"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={removing}
                onClick={remove}
                className="btn-destructive min-h-[44px] min-w-[44px] px-4 disabled:opacity-60"
              >
                {removing
                  ? locationText('removing')
                  : removeError
                    ? t('routeState.tryAgain')
                    : t('common.delete')}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {editorTarget && (
        <Dialog
          open
          variant="form"
          testId="location-editor-dialog"
          title={locationText(editorTarget === 'new' ? 'newTitle' : 'editTitle')}
          description={locationText('formDescription')}
          initialFocusRef={editorLabelRef}
          onClose={editorSaving ? undefined : closeEditor}
          closeLabel={locationText('closeForm')}
        >
          <form onSubmit={saveEditor} className="space-y-4" aria-busy={editorSaving}>
            <div>
              <label htmlFor="location-label" className="label-apple">
                {locationText('label')}
              </label>
              <input
                id="location-label"
                ref={editorLabelRef}
                type="text"
                value={editorLabel}
                onChange={(event) => setEditorLabel(event.target.value)}
                placeholder={locationText('labelPlaceholder')}
                className="input-apple min-h-[44px]"
                disabled={editorSaving}
                required
              />
            </div>
            <div>
              <label htmlFor="location-address" className="label-apple">
                {locationText('address')}
              </label>
              <input
                id="location-address"
                type="text"
                value={editorAddress}
                onChange={(event) => setEditorAddress(event.target.value)}
                placeholder={locationText('addressPlaceholder')}
                className="input-apple min-h-[44px]"
                disabled={editorSaving}
              />
            </div>
            {editorError && (
              <p role="alert" className="text-sm text-danger-text">
                {editorError === 'network'
                  ? locationText('saveNetworkError')
                  : locationText('saveFailed')}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeEditor}
                disabled={editorSaving}
                className="min-h-[44px] min-w-[44px] rounded-lg border border-input px-4 text-foreground disabled:opacity-60"
              >
                {locationText('cancel')}
              </button>
              <button
                type="submit"
                disabled={editorSaving || !editorLabel.trim()}
                className="btn-filled min-h-[44px] min-w-[44px] disabled:opacity-60"
              >
                {editorSaving
                  ? locationText('saving')
                  : editorError
                    ? locationText('retrySave')
                    : editorTarget === 'new'
                      ? locationText('save')
                      : locationText('saveChanges')}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  )
}

function LocationRow({
  location,
  onEdit,
  onRemove,
  last,
}: {
  location: Location
  onEdit: (location: Location) => void
  onRemove: (location: Location) => void
  last: boolean
}) {
  const Icon = ICON_FOR_LABEL[location.label] || MapPin
  const locationText = useLocationsText()
  return (
    <div className={`row-apple ${last ? '' : 'border-b border-[var(--surface-separator)]'}`}>
      <div className="glyph bg-tint-calendar">
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-body text-label-primary">{location.label}</div>
        {location.address && (
          <div className="text-footnote text-label-secondary truncate">{location.address}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onEdit(location)}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-label-tertiary transition-colors"
          aria-label={locationText('editButton', { label: location.label })}
        >
          <Pencil className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(location)}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-label-tertiary active:text-[var(--danger-text)] transition-colors"
          aria-label={locationText('removeButton', { label: location.label })}
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
