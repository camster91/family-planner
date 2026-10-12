'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from '@/i18n'
import { Heart, Plus, ExternalLink } from 'lucide-react'
import { FeatureGate } from '@/components/ui/feature-gate'
import { Dialog } from '@/components/ui/dialog'
import { useMaybeToast } from '@/components/ui/toast'

type WishlistItem = {
  id: string
  title: string
  link: string | null
  description: string | null
  approx_price: string | null
  status: string
  denied_reason: string | null
  requested_by: string
  created_at: string
  requester: { id: string; name: string }
}

/** The server's `error` text, or null when the body has none. */
async function serverError(res: Response): Promise<string | null> {
  const data = await res.json().catch(() => null)
  return data && typeof data.error === 'string' && data.error ? data.error : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isWishlistItem(value: unknown): value is WishlistItem {
  if (!isRecord(value) || !isRecord(value.requester)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    isNullableString(value.link) &&
    isNullableString(value.description) &&
    isNullableString(value.approx_price) &&
    typeof value.status === 'string' &&
    isNullableString(value.denied_reason) &&
    typeof value.requested_by === 'string' &&
    typeof value.created_at === 'string' &&
    typeof value.requester.id === 'string' &&
    typeof value.requester.name === 'string'
  )
}

function responseWishlistItem(value: unknown): WishlistItem | null {
  if (!isRecord(value) || !isWishlistItem(value.item)) return null
  return value.item
}

function matchesStatus(
  item: WishlistItem | undefined,
  id: string,
  status: string,
  deniedReason?: string,
): boolean {
  return Boolean(
    item &&
      item.id === id &&
      item.status === status &&
      (status !== 'denied' || item.denied_reason === deniedReason),
  )
}

function responseMatchesStatus(
  value: unknown,
  id: string,
  status: string,
  deniedReason?: string,
): boolean {
  const item = responseWishlistItem(value)
  if (!item) return false
  return (
    item.id === id &&
    item.status === status &&
    (status !== 'denied' || item.denied_reason === deniedReason)
  )
}

// A 4xx response is a definitive refusal from the canonical API. A 5xx or
// intermediary error can arrive after the status update committed, so it must
// be reconciled before the user retries.
function isDefinitiveStatusRefusal(status: number): boolean {
  return Number.isInteger(status) && status >= 400 && status < 500
}

type UserRole = 'parent' | 'child' | 'teen'

function WishlistContent() {
  const { t } = useTranslation()
  const [items, setItems] = useState<WishlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingItem, setEditingItem] = useState<WishlistItem | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [deletingItem, setDeletingItem] = useState<WishlistItem | null>(null)
  const [denialDraft, setDenialDraft] = useState<{
    itemId: string
    title: string
    reason: string
  } | null>(null)
  const [userId, setUserId] = useState<string>('')
  const [userRole, setUserRole] = useState<UserRole>('child')
  const [submitting, setSubmitting] = useState(false)
  // Why the open modal's last save/delete failed; the modal stays open.
  const [modalError, setModalError] = useState<string | null>(null)
  const [statusModalError, setStatusModalError] = useState<string | null>(null)
  const [pendingStatusIds, setPendingStatusIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const pendingStatusIdsRef = useRef<Set<string>>(new Set())
  const itemsRequestRef = useRef(0)
  const denialReasonRef = useRef<HTMLTextAreaElement>(null)
  // Native selects do not always remain the active element while their
  // change event opens a modal. Keep a stable item-owned target so the
  // completed denial flow can return focus after the row has re-rendered.
  const statusSelectRefs = useRef(new Map<string, HTMLSelectElement>())
  const statusFocusIdRef = useRef<string | null>(null)
  const { addToast } = useMaybeToast()

  const [formTitle, setFormTitle] = useState('')
  const [formLink, setFormLink] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPrice, setFormPrice] = useState('')

  const fetchItems = useCallback(async (options?: { showPageError?: boolean }) => {
    const showPageError = options?.showPageError ?? true
    const requestId = ++itemsRequestRef.current
    try {
      const res = await fetch('/api/wishlist')
      if (!res.ok) throw new Error(t('wishlist.errorLoad'))
      const data = await res.json()
      if (!isRecord(data) || !Array.isArray(data.items)) {
        throw new Error(t('wishlist.errorLoad'))
      }
      const nextItems = data.items as WishlistItem[]
      // A later refresh is authoritative even if an older request resolves
      // afterward. Still return the parsed response to the initiating status
      // operation so it can reconcile its own write.
      if (requestId === itemsRequestRef.current) {
        setItems(nextItems)
        setError(null)
      }
      return nextItems
    } catch (e: unknown) {
      if (showPageError && requestId === itemsRequestRef.current) {
        setError(e instanceof Error ? e.message : t('wishlist.errorLoad'))
      }
      return null
    } finally {
      if (requestId === itemsRequestRef.current) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json().catch(() => null))
      .then(data => {
        if (data?.user) {
          setUserId(data.user.id || '')
          setUserRole(data.user.role || 'child')
        }
      })
      .finally(() => fetchItems())
  }, [fetchItems])

  const handleAddWish = async () => {
    if (!formTitle.trim()) return
    setSubmitting(true)
    setModalError(null)
    try {
      const res = await fetch('/api/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle.trim(),
          link: formLink.trim() || null,
          description: formDescription.trim() || null,
          approx_price: formPrice ? parseFloat(formPrice) : null,
        }),
      })
      if (!res.ok) {
        setModalError(`${t('wishlist.errorSave')} ${(await serverError(res)) ?? t('common.tryAgain')}`)
        return
      }
      await fetchItems()
      setShowAddModal(false)
      setFormTitle('')
      setFormLink('')
      setFormDescription('')
      setFormPrice('')
    } catch {
      setModalError(`${t('wishlist.errorSave')} ${t('common.networkError')}`)
    } finally {
      setSubmitting(false)
    }
  }

  const beginStatus = (id: string) => {
    if (pendingStatusIdsRef.current.has(id)) return false
    const next = new Set(pendingStatusIdsRef.current)
    next.add(id)
    pendingStatusIdsRef.current = next
    setPendingStatusIds(next)
    return true
  }

  const endStatus = (id: string) => {
    const next = new Set(pendingStatusIdsRef.current)
    next.delete(id)
    pendingStatusIdsRef.current = next
    setPendingStatusIds(next)
  }

  const reconcileStatus = useCallback(
    async (id: string, status: string, deniedReason?: string) => {
      const refreshed = await fetchItems({ showPageError: false })
      return Boolean(
        refreshed?.some((item) => matchesStatus(item, id, status, deniedReason)),
      )
    },
    [fetchItems],
  )

  const reportStatusError = (message: string, target: 'toast' | 'modal') => {
    if (target === 'modal') {
      setStatusModalError(message)
    } else {
      addToast({ type: 'error', title: t('wishlist.errorStatus'), message })
    }
  }

  const handleStatusChange = async (
    id: string,
    status: string,
    deniedReason?: string,
    errorTarget: 'toast' | 'modal' = 'toast',
  ) => {
    if (!beginStatus(id)) return false
    const normalizedReason = status === 'denied' ? deniedReason?.trim() : undefined
    try {
      let res: Response
      try {
        res = await fetch(`/api/wishlist/${id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status,
            ...(normalizedReason ? { denied_reason: normalizedReason } : {}),
          }),
        })
      } catch {
        const confirmed = await reconcileStatus(id, status, normalizedReason)
        if (!confirmed) {
          reportStatusError(t('wishlist.statusUncertain'), errorTarget)
        }
        return confirmed
      }
      if (!res.ok) {
        if (!isDefinitiveStatusRefusal(res.status)) {
          const confirmed = await reconcileStatus(id, status, normalizedReason)
          if (!confirmed) {
            reportStatusError(t('wishlist.statusUncertain'), errorTarget)
          }
          return confirmed
        }
        reportStatusError(
          (await serverError(res)) ?? t('common.tryAgain'),
          errorTarget,
        )
        return false
      }

      const payload = await res.json().catch(() => null)
      if (!responseMatchesStatus(payload, id, status, normalizedReason)) {
        const confirmed = await reconcileStatus(id, status, normalizedReason)
        if (!confirmed) {
          reportStatusError(t('wishlist.statusUncertain'), errorTarget)
        }
        return confirmed
      }

      // The PATCH response is the canonical write result. Apply the complete
      // item before the follow-up GET so a lost/failed refresh cannot leave the
      // changed select or denial dialog showing its old status. Only replace
      // the affected row; every other row and its raw fields stay untouched.
      const confirmedItem = responseWishlistItem(payload)
      if (!confirmedItem) return false
      setItems((current) =>
        current.map((item) => (item.id === id ? confirmedItem : item)),
      )
      const refreshed = await fetchItems({ showPageError: false })
      if (
        !refreshed ||
        !refreshed.some((item) =>
          matchesStatus(item, id, status, normalizedReason),
        )
      ) {
        // A refresh can fail or return stale data after the canonical PATCH.
        // Keep the confirmed row visible while reporting that the list itself
        // could not be refreshed.
        setItems((current) =>
          current.map((item) => (item.id === id ? confirmedItem : item)),
        )
        addToast({
          type: 'error',
          title: t('wishlist.errorStatus'),
          message: t('wishlist.statusSavedRefreshFailed'),
        })
      }
      return true
    } finally {
      endStatus(id)
    }
  }

  useEffect(() => {
    const itemId = statusFocusIdRef.current
    if (!itemId || denialDraft || pendingStatusIds.has(itemId)) return

    statusFocusIdRef.current = null
    const select = statusSelectRefs.current.get(itemId)
    if (select && !select.disabled) select.focus()
  }, [denialDraft, items, pendingStatusIds])

  const openDenialModal = (item: WishlistItem) => {
    setStatusModalError(null)
    setDenialDraft({ itemId: item.id, title: item.title, reason: '' })
  }

  const closeDenialModal = () => {
    if (denialDraft && pendingStatusIdsRef.current.has(denialDraft.itemId)) return
    if (denialDraft) statusFocusIdRef.current = denialDraft.itemId
    setStatusModalError(null)
    setDenialDraft(null)
  }

  const confirmDenial = async () => {
    if (!denialDraft) return
    const reason = denialDraft.reason.trim()
    if (!reason) {
      setStatusModalError(t('wishlist.denialReasonRequired'))
      return
    }
    const saved = await handleStatusChange(
      denialDraft.itemId,
      'denied',
      reason,
      'modal',
    )
    if (saved) {
      statusFocusIdRef.current = denialDraft.itemId
      setStatusModalError(null)
      setDenialDraft(null)
    }
  }

  const handleDelete = async () => {
    if (!deletingItem) return
    setSubmitting(true)
    setModalError(null)
    try {
      const res = await fetch(`/api/wishlist/${deletingItem.id}`, { method: 'DELETE' })
      if (!res.ok) {
        setModalError(`${t('wishlist.errorDelete')} ${(await serverError(res)) ?? t('common.tryAgain')}`)
        return
      }
      await fetchItems()
      setDeletingItem(null)
    } catch {
      setModalError(`${t('wishlist.errorDelete')} ${t('common.networkError')}`)
    } finally {
      setSubmitting(false)
    }
  }

  const openEditModal = (item: WishlistItem) => {
    setModalError(null)
    setEditingItem(item)
    setEditTitle(item.title)
  }

  const handleEditTitle = async () => {
    if (!editingItem || !editTitle.trim()) return
    if (editTitle.trim() === editingItem.title) {
      setEditingItem(null)
      return
    }

    setSubmitting(true)
    setModalError(null)
    try {
      const res = await fetch(`/api/wishlist/${editingItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle.trim() }),
      })
      if (!res.ok) {
        setModalError(`${t('wishlist.errorSave')} ${(await serverError(res)) ?? t('common.tryAgain')}`)
        return
      }
      await fetchItems()
      setEditingItem(null)
      setEditTitle('')
    } catch {
      setModalError(`${t('wishlist.errorSave')} ${t('common.networkError')}`)
    } finally {
      setSubmitting(false)
    }
  }

  const modalErrorText = modalError && (
    <p role="alert" className="text-footnote text-[var(--danger-text)]">
      {modalError}
    </p>
  )

  const isParent = userRole === 'parent'
  const visibleItems = isParent ? items : items.filter(i => i.requested_by === userId)

  const groupedItems = visibleItems.reduce<Record<string, WishlistItem[]>>((acc, item) => {
    const key = item.requester.name
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})

  const statusMeta: Record<string, { label: string; color: string; dot: string }> = {
    idle: { label: t('wishlist.status.idle'), color: 'text-label-secondary', dot: 'bg-label-tertiary' },
    on_the_way: { label: t('wishlist.coming'), color: 'text-primary', dot: 'bg-primary' },
    received: { label: t('wishlist.gotIt'), color: 'text-success-text', dot: 'bg-success' },
    denied: { label: t('wishlist.status.denied'), color: 'text-danger-text', dot: 'bg-danger-fill' },
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-subhead text-label-secondary">{t('wishlist.loading')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-subhead text-danger-text">{error}</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-large-title font-display">{t('wishlist.title')}</h1>
          <p className="text-subhead text-label-secondary mt-1">{t('wishlist.subtitle')}</p>
        </div>
        <button
          onClick={() => {
            setModalError(null)
            setShowAddModal(true)
          }}
          className="btn-filled flex items-center gap-2 px-4 py-2 rounded-full text-body font-semibold"
        >
          <Plus size={18} aria-hidden="true" />
          {t('wishlist.addWish')}
        </button>
      </div>

      {/* Empty state */}
      {visibleItems.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[var(--surface-fill)] flex items-center justify-center mb-4">
            <Heart className="text-label-tertiary" size={28} />
          </div>
          <h2 className="text-title-2 font-semibold">{t('wishlist.empty')}</h2>
          <p className="text-subhead text-label-secondary mt-1">{t('wishlist.emptySubtitle')}</p>
        </div>
      )}

      {/* Grouped items */}
      {Object.entries(groupedItems).map(([requesterName, requesterItems]) => (
        <div key={requesterName}>
          {isParent && (
            <p className="text-caption-1 text-label-tertiary uppercase tracking-wide mb-2 ml-1">
              {requesterName}&apos;s wishes
            </p>
          )}
          <div className="space-y-2">
            {requesterItems.map((item) => {
              const meta = statusMeta[item.status] || statusMeta.idle
              return (
                <div
                  key={item.id}
                  className="bg-[var(--surface-elevated)] rounded-2xl p-4 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-headline font-semibold truncate">{item.title}</h2>
                        <span className={`flex items-center gap-1 text-caption-1 font-medium ${meta.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </div>
                      {item.link && (
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-caption-1 text-primary mt-1 hover:underline"
                        >
                          <ExternalLink size={12} />
                          {item.link.length > 40 ? item.link.slice(0, 40) + '...' : item.link}
                        </a>
                      )}
                      {item.description && (
                        <p className="text-subhead text-label-secondary mt-1">{item.description}</p>
                      )}
                      {item.approx_price && (
                        <p className="text-callout text-label-secondary mt-1">
                          ~${item.approx_price}
                        </p>
                      )}
                      {item.status === 'denied' && item.denied_reason && (
                        <p className="text-caption-1 text-danger-text mt-1 italic">
                          {t('wishlist.deniedReason')}: {item.denied_reason}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isParent && (
                        <select
                          ref={(node) => {
                            if (node) statusSelectRefs.current.set(item.id, node)
                            else statusSelectRefs.current.delete(item.id)
                          }}
                          value={item.status}
                          disabled={pendingStatusIds.has(item.id)}
                          aria-busy={pendingStatusIds.has(item.id) || undefined}
                          onChange={(e) => {
                            if (e.target.value === 'denied') {
                              statusSelectRefs.current.set(item.id, e.currentTarget)
                              openDenialModal(item)
                            } else {
                              void handleStatusChange(item.id, e.target.value)
                            }
                          }}
                          aria-label={`Status for ${item.title}`}
                          className="min-h-11 text-caption-1 bg-[var(--surface-fill)] border border-[var(--surface-separator)] rounded-lg px-2 py-1 disabled:opacity-60"
                        >
                          <option value="idle">{t('wishlist.status.idle')}</option>
                          <option value="on_the_way">{t('wishlist.status.onTheWay')}</option>
                          <option value="received">{t('wishlist.status.received')}</option>
                          <option value="denied">{t('wishlist.status.denied')}</option>
                        </select>
                      )}
                      {item.requested_by === userId && (
                        <>
                          <button
                            onClick={() => openEditModal(item)}
                            className="btn-ghost h-11 w-11 p-0 rounded-lg"
                            title={t('wishlist.edit')}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              setModalError(null)
                              setDeletingItem(item)
                            }}
                            className="btn-ghost h-11 w-11 p-0 rounded-lg text-danger-text"
                            title={t('wishlist.delete')}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <Dialog
        open={!!denialDraft}
        onClose={closeDenialModal}
        title={t('wishlist.denyWish')}
        description={denialDraft?.title}
        initialFocusRef={denialReasonRef}
        closeLabel={t('wishlist.cancel')}
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="wishlist-denial-reason"
              className="text-callout font-medium block mb-1.5"
            >
              {t('wishlist.deniedReason')}
            </label>
            <textarea
              ref={denialReasonRef}
              id="wishlist-denial-reason"
              value={denialDraft?.reason ?? ''}
              onChange={(e) =>
                setDenialDraft((current) =>
                  current ? { ...current, reason: e.target.value } : current,
                )
              }
              maxLength={500}
              rows={3}
              placeholder={t('wishlist.denialReasonPlaceholder')}
              className="w-full min-h-24 resize-none rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-4 py-3 text-body focus:border-[var(--focus-ring)] focus:outline-none"
            />
          </div>
          {statusModalError && (
            <p role="alert" className="text-footnote text-[var(--danger-text)]">
              {statusModalError}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={closeDenialModal}
              disabled={Boolean(denialDraft && pendingStatusIds.has(denialDraft.itemId))}
              className="min-h-11 flex-1 btn-ghost rounded-xl text-body font-semibold disabled:opacity-50"
            >
              {t('wishlist.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void confirmDenial()}
              disabled={
                !denialDraft?.reason.trim() ||
                Boolean(denialDraft && pendingStatusIds.has(denialDraft.itemId))
              }
              className="min-h-11 flex-1 btn-filled rounded-xl text-body font-semibold disabled:opacity-50"
            >
              {t('wishlist.confirmDenial')}
            </button>
          </div>
        </div>
      </Dialog>

      {/* Add Wish Modal */}
      <Dialog open={showAddModal} onClose={() => setShowAddModal(false)} title={t('wishlist.addWish')}>
        <div className="space-y-4">
          <div>
            <label htmlFor="add-wish-title" className="text-callout font-medium block mb-1.5">
              {t('wishlist.wishTitle')} *
            </label>
            <input
              id="add-wish-title"
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Nintendo Switch"
              required
              className="w-full bg-[var(--surface-fill)] rounded-xl px-4 py-3 text-body border border-[var(--surface-separator)] focus:border-[var(--focus-ring)] focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="add-wish-link" className="text-callout font-medium block mb-1.5">
              {t('wishlist.link')}
            </label>
            <input
              id="add-wish-link"
              type="url"
              value={formLink}
              onChange={(e) => setFormLink(e.target.value)}
              placeholder="https://..."
              className="w-full bg-[var(--surface-fill)] rounded-xl px-4 py-3 text-body border border-[var(--surface-separator)] focus:border-[var(--focus-ring)] focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="add-wish-description" className="text-callout font-medium block mb-1.5">
              {t('wishlist.description')}
            </label>
            <textarea
              id="add-wish-description"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Optional details..."
              rows={3}
              className="w-full bg-[var(--surface-fill)] rounded-xl px-4 py-3 text-body border border-[var(--surface-separator)] focus:border-[var(--focus-ring)] focus:outline-none resize-none"
            />
          </div>
          <div>
            <label htmlFor="add-wish-price" className="text-callout font-medium block mb-1.5">
              {t('wishlist.approxPrice')}
            </label>
            <input
              id="add-wish-price"
              type="number"
              value={formPrice}
              onChange={(e) => setFormPrice(e.target.value)}
              placeholder="149.99"
              step="0.01"
              min="0"
              className="w-full bg-[var(--surface-fill)] rounded-xl px-4 py-3 text-body border border-[var(--surface-separator)] focus:border-[var(--focus-ring)] focus:outline-none"
            />
          </div>
          {modalErrorText}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="flex-1 btn-ghost py-3 rounded-xl text-body font-semibold"
            >
              {t('wishlist.cancel')}
            </button>
            <button
              type="button"
              onClick={handleAddWish}
              disabled={submitting || !formTitle.trim()}
              className="flex-1 btn-filled py-3 rounded-xl text-body font-semibold disabled:opacity-50"
            >
              {submitting ? '...' : t('wishlist.save')}
            </button>
          </div>
        </div>
      </Dialog>

      {/* Edit Wish Modal */}
      <Dialog open={!!editingItem} onClose={() => setEditingItem(null)} title={t('wishlist.edit')}>
        <div className="space-y-4">
          <div>
            <label htmlFor="edit-wish-name" className="text-callout font-medium block mb-1.5">
              {t('wishlist.wishTitle')} *
            </label>
            <input
              id="edit-wish-name"
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full bg-[var(--surface-fill)] rounded-xl px-4 py-3 text-body border border-[var(--surface-separator)] focus:border-[var(--focus-ring)] focus:outline-none"
            />
          </div>
          {modalErrorText}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setEditingItem(null)}
              className="flex-1 btn-ghost py-3 rounded-xl text-body font-semibold"
            >
              {t('wishlist.cancel')}
            </button>
            <button
              type="button"
              onClick={handleEditTitle}
              disabled={submitting || !editTitle.trim()}
              className="flex-1 btn-filled py-3 rounded-xl text-body font-semibold disabled:opacity-50"
            >
              {submitting ? '...' : t('wishlist.save')}
            </button>
          </div>
        </div>
      </Dialog>

      {/* Delete Wish Confirmation */}
      <Dialog
        open={!!deletingItem}
        onClose={() => {
          setModalError(null)
          setDeletingItem(null)
        }}
        title={t('wishlist.delete')}
        description={deletingItem?.title}
        role="alertdialog"
      >
        <div className="space-y-3">
          {modalErrorText}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setModalError(null)
                setDeletingItem(null)
              }}
              className="flex-1 btn-ghost py-3 rounded-xl text-body font-semibold"
            >
              {t('wishlist.cancel')}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={submitting}
              className="flex-1 rounded-xl py-3 text-body font-semibold bg-danger-fill text-white disabled:opacity-50"
            >
              {submitting ? '...' : t('wishlist.delete')}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

export default function WishlistPage() {
  return (
    <FeatureGate featureKey="wishlist">
      <WishlistContent />
    </FeatureGate>
  )
}
