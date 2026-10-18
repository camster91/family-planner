'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Heart, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { Dialog } from '@/components/ui/dialog'
import { FeatureGate } from '@/components/ui/feature-gate'
import { useMaybeToast } from '@/components/ui/toast'

const WISHLIST_STATUSES = ['idle', 'on_the_way', 'received', 'denied'] as const
type WishlistStatus = (typeof WISHLIST_STATUSES)[number]
type UserRole = 'parent' | 'child' | 'teen'

type WishlistItem = {
  id: string
  title: string
  link: string | null
  description: string | null
  approx_price: string | null
  status: WishlistStatus
  denied_reason: string | null
  requested_by: string
  created_at: string
  requester: { id: string; name: string }
}

type RefreshNotice = 'saved' | 'deleted' | 'status'
type RefreshRecovery = {
  kind: RefreshNotice
  confirmed: WishlistItem | null
  deletedId?: string
}

type ServerErrorDetails = {
  message: string | null
  code: string | null
  retryable: boolean | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isWishlistStatus(value: unknown): value is WishlistStatus {
  return (
    typeof value === 'string' &&
    WISHLIST_STATUSES.includes(value as WishlistStatus)
  )
}

function isWishlistItem(value: unknown): value is WishlistItem {
  if (!isRecord(value) || !isRecord(value.requester)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    isNullableString(value.link) &&
    isNullableString(value.description) &&
    isNullableString(value.approx_price) &&
    isWishlistStatus(value.status) &&
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

function responseWishlistItems(value: unknown): WishlistItem[] | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null
  return value.items.every(isWishlistItem) ? value.items : null
}

function sameApproxPrice(a: string | null, b: string | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  const aNumber = Number(a)
  const bNumber = Number(b)
  return Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber === bNumber
}

function sameWishlistIdentity(a: WishlistItem, b: WishlistItem): boolean {
  return (
    a.id === b.id &&
    a.requested_by === b.requested_by &&
    a.created_at === b.created_at &&
    a.requester.id === b.requester.id &&
    a.requester.name === b.requester.name
  )
}

function sameWishlistFields(a: WishlistItem, b: WishlistItem): boolean {
  return (
    a.title === b.title &&
    a.link === b.link &&
    a.description === b.description &&
    sameApproxPrice(a.approx_price, b.approx_price)
  )
}

function sameWishlistDraft(
  item: WishlistItem,
  draft: Pick<WishlistItem, 'title' | 'link' | 'description' | 'approx_price'>,
): boolean {
  return (
    item.title === draft.title &&
    item.link === draft.link &&
    item.description === draft.description &&
    sameApproxPrice(item.approx_price, draft.approx_price)
  )
}

function matchesStatus(
  item: WishlistItem | undefined,
  id: string,
  status: string,
  deniedReason?: string,
  expected?: WishlistItem,
): boolean {
  return Boolean(
    item &&
    item.id === id &&
    item.status === status &&
    (status !== 'denied' || item.denied_reason === deniedReason) &&
    (!expected ||
      (sameWishlistIdentity(item, expected) &&
        sameWishlistFields(item, expected))),
  )
}

function responseMatchesStatus(
  value: unknown,
  expected: WishlistItem,
  status: string,
  deniedReason?: string,
): boolean {
  return matchesStatus(
    responseWishlistItem(value) ?? undefined,
    expected.id,
    status,
    deniedReason,
    expected,
  )
}

function sameWishlistItem(a: WishlistItem, b: WishlistItem): boolean {
  return (
    sameWishlistIdentity(a, b) &&
    sameWishlistFields(a, b) &&
    a.status === b.status &&
    a.denied_reason === b.denied_reason
  )
}

function responseMatchesDraft(
  value: unknown,
  expected: WishlistItem,
  draft: Pick<WishlistItem, 'title' | 'link' | 'description' | 'approx_price'>,
): WishlistItem | null {
  const item = responseWishlistItem(value)
  if (!item || !sameWishlistIdentity(item, expected)) return null
  return sameWishlistDraft(item, draft) ? item : null
}

function responseMatchesCreatedItem(
  value: unknown,
  requesterId: string,
  draft: Pick<WishlistItem, 'title' | 'link' | 'description' | 'approx_price'>,
): WishlistItem | null {
  const item = responseWishlistItem(value)
  if (
    !item ||
    item.requested_by !== requesterId ||
    item.requester.id !== requesterId
  ) {
    return null
  }
  return sameWishlistDraft(item, draft) ? item : null
}

async function serverErrorDetails(res: Response): Promise<ServerErrorDetails> {
  const data = await res.json().catch(() => null)
  if (!isRecord(data)) {
    return { message: null, code: null, retryable: null }
  }
  const nested = isRecord(data.error) ? data.error : null
  return {
    message:
      (nested && typeof nested.message === 'string' && nested.message) ||
      (typeof data.error === 'string' && data.error) ||
      null,
    code:
      (nested && typeof nested.code === 'string' && nested.code) ||
      (typeof data.code === 'string' && data.code) ||
      null,
    retryable:
      nested && typeof nested.retryable === 'boolean'
        ? nested.retryable
        : typeof data.retryable === 'boolean'
          ? data.retryable
          : null,
  }
}

function isDefinitiveRefusal(
  status: number,
  details: ServerErrorDetails,
): boolean {
  if (!Number.isInteger(status) || status < 400 || status >= 500) return false
  // These transport failures are ambiguous: the server may have committed
  // the keyed mutation even though the response did not reach the client.
  // Keep the key so the next attempt can replay the same effect safely.
  if (status === 408 || status === 425 || status === 429) return false
  if (status === 409) {
    return details.code !== 'IDEMPOTENCY_IN_PROGRESS' && details.retryable === false
  }
  return details.retryable !== true
}

function newMutationKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function WishlistContent() {
  const { t } = useTranslation()
  const { addToast, removeToast } = useMaybeToast()
  const [items, setItems] = useState<WishlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingItem, setEditingItem] = useState<WishlistItem | null>(null)
  const [deletingItem, setDeletingItem] = useState<WishlistItem | null>(null)
  const [denialDraft, setDenialDraft] = useState<{
    itemId: string
    title: string
    reason: string
  } | null>(null)
  const [userId, setUserId] = useState('')
  const [userRole, setUserRole] = useState<UserRole>('child')
  const [submitting, setSubmitting] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [statusModalError, setStatusModalError] = useState<string | null>(null)
  const [refreshNotice, setRefreshNotice] = useState<RefreshNotice | null>(null)
  const [pendingStatusIds, setPendingStatusIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [formTitle, setFormTitle] = useState('')
  const [formLink, setFormLink] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPrice, setFormPrice] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editLink, setEditLink] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editPrice, setEditPrice] = useState('')

  const pendingStatusIdsRef = useRef<Set<string>>(new Set())
  const itemsRequestRef = useRef(0)
  const mutationRequestsRef = useRef(
    new Map<string, { body: string; key: string }>(),
  )
  const refreshRecoveryRef = useRef<RefreshRecovery | null>(null)
  const denialReasonRef = useRef<HTMLTextAreaElement>(null)
  const statusSelectRefs = useRef(new Map<string, HTMLSelectElement>())
  const statusFocusIdRef = useRef<string | null>(null)

  const statusNoticeId = (id: string) =>
    `wishlist-status:${userId || 'session'}:${id}`

  const clearStatusNotice = (id: string) => {
    removeToast(statusNoticeId(id))
  }

  const fetchItems = useCallback(
    async (options?: { showPageError?: boolean }) => {
      const showPageError = options?.showPageError ?? true
      const requestId = ++itemsRequestRef.current
      try {
        const res = await fetch('/api/wishlist')
        if (!res.ok) throw new Error(t('wishlist.errorLoad'))
        const data = await res.json()
        const nextItems = responseWishlistItems(data)
        if (!nextItems) throw new Error(t('wishlist.errorLoad'))
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
    },
    [t],
  )

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        const role = data?.user?.role
        if (data?.user) {
          setUserId(typeof data.user.id === 'string' ? data.user.id : '')
          if (role === 'parent' || role === 'child' || role === 'teen') {
            setUserRole(role)
          }
        }
      })
      .finally(() => fetchItems())
  }, [fetchItems])

  const getMutationKey = (scope: string, body: string): string => {
    // These keys are ready for the canonical receipt API; until that API is
    // integrated, an uncertain request stays unresolved and is never replayed
    // automatically by the UI.
    const existing = mutationRequestsRef.current.get(scope)
    if (existing?.body === body) return existing.key
    const key = newMutationKey()
    mutationRequestsRef.current.set(scope, { body, key })
    return key
  }

  const clearMutationKey = (scope: string) => {
    mutationRequestsRef.current.delete(scope)
  }

  const refreshAfterConfirmedWrite = async (
    kind: RefreshNotice,
    confirmed: WishlistItem | null,
    deletedId?: string,
  ) => {
    const recovery = { kind, confirmed, deletedId }
    const refreshed = await fetchItems({ showPageError: false })
    if (!refreshed) {
      refreshRecoveryRef.current = recovery
      setRefreshNotice(kind)
      setItems((current) => {
        if (deletedId) return current.filter((item) => item.id !== deletedId)
        if (!confirmed) return current
        const index = current.findIndex((item) => item.id === confirmed.id)
        if (index < 0) return [confirmed, ...current]
        const next = [...current]
        next[index] = confirmed
        return next
      })
      return
    }

    if (deletedId) {
      if (refreshed.some((item) => item.id === deletedId)) {
        refreshRecoveryRef.current = recovery
        setRefreshNotice(kind)
        setItems((current) => current.filter((item) => item.id !== deletedId))
      } else {
        refreshRecoveryRef.current = null
        setRefreshNotice(null)
      }
      return
    }

    if (confirmed) {
      const fresh = refreshed.find((item) => item.id === confirmed.id)
      if (!fresh || !sameWishlistItem(fresh, confirmed)) {
        refreshRecoveryRef.current = recovery
        setRefreshNotice(kind)
        setItems((current) => {
          const index = current.findIndex((item) => item.id === confirmed.id)
          if (index < 0) return [confirmed, ...current]
          const next = [...current]
          next[index] = confirmed
          return next
        })
        return
      }
    }
    refreshRecoveryRef.current = null
    setRefreshNotice(null)
  }

  const retryRefresh = async () => {
    const refreshed = await fetchItems({ showPageError: false })
    if (!refreshed) return
    const recovery = refreshRecoveryRef.current
    if (!recovery) {
      setRefreshNotice(null)
      return
    }
    if (
      recovery.deletedId &&
      refreshed.some((item) => item.id === recovery.deletedId)
    ) {
      setItems((current) =>
        current.filter((item) => item.id !== recovery.deletedId),
      )
      setRefreshNotice(recovery.kind)
      return
    }
    if (recovery.confirmed) {
      const fresh = refreshed.find((item) => item.id === recovery.confirmed?.id)
      if (!fresh || !sameWishlistItem(fresh, recovery.confirmed)) {
        setItems((current) => {
          const index = current.findIndex(
            (item) => item.id === recovery.confirmed?.id,
          )
          if (index < 0) return [recovery.confirmed!, ...current]
          const next = [...current]
          next[index] = recovery.confirmed!
          return next
        })
        setRefreshNotice(recovery.kind)
        return
      }
    }
    refreshRecoveryRef.current = null
    setRefreshNotice(null)
  }

  const handleAddWish = async () => {
    if (!formTitle.trim() || submitting) return
    const link = formLink.trim()
    if (link && !isHttpUrl(link)) {
      setModalError(t('wishlist.invalidLink'))
      return
    }
    setSubmitting(true)
    setModalError(null)
    setRefreshNotice(null)
    refreshRecoveryRef.current = null
    const body = JSON.stringify({
      title: formTitle.trim(),
      link: link || null,
      description: formDescription.trim() || null,
      approx_price: formPrice.trim() || null,
    })
    const mutationKey = getMutationKey('add', body)
    try {
      let res: Response
      try {
        res = await fetch('/api/wishlist', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // The API binds this key to the canonical mutation body so a
            // retry can replay one effect safely.
            'Idempotency-Key': mutationKey,
          },
          body,
        })
      } catch {
        setModalError(t('wishlist.writeUncertain'))
        return
      }
      if (!res.ok) {
        const details = await serverErrorDetails(res)
        if (!isDefinitiveRefusal(res.status, details)) {
          setModalError(t('wishlist.writeUncertain'))
        } else {
          clearMutationKey('add')
          setModalError(t('wishlist.errorSave'))
        }
        return
      }
      const confirmed = responseMatchesCreatedItem(
        await res.json().catch(() => null),
        userId,
        JSON.parse(body) as Pick<
          WishlistItem,
          'title' | 'link' | 'description' | 'approx_price'
        >,
      )
      if (!confirmed) {
        setModalError(t('wishlist.writeUncertain'))
        return
      }
      clearMutationKey('add')
      setItems((current) => [
        confirmed,
        ...current.filter((item) => item.id !== confirmed.id),
      ])
      await refreshAfterConfirmedWrite('saved', confirmed)
      setShowAddModal(false)
      setFormTitle('')
      setFormLink('')
      setFormDescription('')
      setFormPrice('')
    } catch {
      setModalError(t('wishlist.writeUncertain'))
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
    async (
      id: string,
      status: string,
      deniedReason?: string,
      expected?: WishlistItem,
    ) => {
      const refreshed = await fetchItems({ showPageError: false })
      return Boolean(
        refreshed?.some((item) =>
          matchesStatus(item, id, status, deniedReason, expected),
        ),
      )
    },
    [fetchItems],
  )

  const reportStatusError = (
    id: string,
    message: string,
    target: 'toast' | 'modal',
  ) => {
    if (target === 'modal') setStatusModalError(message)
    else
      addToast({
        id: statusNoticeId(id),
        type: 'error',
        title: t('wishlist.errorStatus'),
        message,
      })
  }

  const handleStatusChange = async (
    id: string,
    status: string,
    deniedReason?: string,
    errorTarget: 'toast' | 'modal' = 'toast',
  ) => {
    if (!beginStatus(id)) return false
    const normalizedReason =
      status === 'denied' ? deniedReason?.trim() : undefined
    const currentItem = items.find((item) => item.id === id)
    const body = JSON.stringify({
      status,
      ...(normalizedReason ? { denied_reason: normalizedReason } : {}),
    })
    const scope = `status:${id}`
    const mutationKey = getMutationKey(scope, body)
    try {
      let res: Response
      try {
        res = await fetch(`/api/wishlist/${id}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': mutationKey,
          },
          body,
        })
      } catch {
        const confirmed = await reconcileStatus(
          id,
          status,
          normalizedReason,
          currentItem,
        )
        if (confirmed) {
          clearMutationKey(scope)
          clearStatusNotice(id)
        }
        if (!confirmed)
          reportStatusError(id, t('wishlist.statusUncertain'), errorTarget)
        return confirmed
      }
      if (!res.ok) {
        const details = await serverErrorDetails(res)
        if (!isDefinitiveRefusal(res.status, details)) {
          const confirmed = await reconcileStatus(
            id,
            status,
            normalizedReason,
            currentItem,
          )
          if (confirmed) {
            clearMutationKey(scope)
            clearStatusNotice(id)
          }
          if (!confirmed)
            reportStatusError(id, t('wishlist.statusUncertain'), errorTarget)
          return confirmed
        }
        clearMutationKey(scope)
        reportStatusError(id, t('wishlist.errorStatus'), errorTarget)
        return false
      }

      const payload = await res.json().catch(() => null)
      if (
        !currentItem ||
        !responseMatchesStatus(payload, currentItem, status, normalizedReason)
      ) {
        const confirmed = await reconcileStatus(
          id,
          status,
          normalizedReason,
          currentItem,
        )
        if (confirmed) {
          clearMutationKey(scope)
          clearStatusNotice(id)
        }
        if (!confirmed)
          reportStatusError(id, t('wishlist.statusUncertain'), errorTarget)
        return confirmed
      }

      const confirmedItem = responseWishlistItem(payload)
      if (!confirmedItem) return false
      clearMutationKey(scope)
      clearStatusNotice(id)
      setItems((current) =>
        current.map((item) => (item.id === id ? confirmedItem : item)),
      )
      await refreshAfterConfirmedWrite('status', confirmedItem)
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
    if (denialDraft && pendingStatusIdsRef.current.has(denialDraft.itemId))
      return
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
    if (!deletingItem || submitting) return
    setSubmitting(true)
    setModalError(null)
    const item = deletingItem
    refreshRecoveryRef.current = null
    const scope = `delete:${item.id}`
    const mutationKey = getMutationKey(scope, '')
    try {
      let res: Response
      try {
        res = await fetch(`/api/wishlist/${item.id}`, {
          method: 'DELETE',
          headers: { 'Idempotency-Key': mutationKey },
        })
      } catch {
        setModalError(t('wishlist.writeUncertain'))
        return
      }
      if (!res.ok) {
        const details = await serverErrorDetails(res)
        if (!isDefinitiveRefusal(res.status, details))
          setModalError(t('wishlist.writeUncertain'))
        else {
          clearMutationKey(scope)
          setModalError(t('wishlist.errorDelete'))
        }
        return
      }
      const payload = await res.json().catch(() => null)
      if (!isRecord(payload) || payload.success !== true) {
        setModalError(t('wishlist.writeUncertain'))
        return
      }
      clearMutationKey(scope)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      await refreshAfterConfirmedWrite('deleted', null, item.id)
      setDeletingItem(null)
    } catch {
      setModalError(t('wishlist.writeUncertain'))
    } finally {
      setSubmitting(false)
    }
  }

  const openEditModal = (item: WishlistItem) => {
    setModalError(null)
    setEditingItem(item)
    setEditTitle(item.title)
    setEditLink(item.link ?? '')
    setEditDescription(item.description ?? '')
    setEditPrice(item.approx_price ?? '')
  }

  const handleEdit = async () => {
    if (!editingItem || !editTitle.trim() || submitting) return
    const link = editLink.trim()
    if (link && !isHttpUrl(link)) {
      setModalError(t('wishlist.invalidLink'))
      return
    }
    const payload = {
      title: editTitle.trim(),
      link: link || null,
      description: editDescription.trim() || null,
      approx_price: editPrice.trim() || null,
    }
    const body = JSON.stringify(payload)
    if (
      body ===
      JSON.stringify({
        title: editingItem.title,
        link: editingItem.link,
        description: editingItem.description,
        approx_price: editingItem.approx_price,
      })
    ) {
      setEditingItem(null)
      return
    }
    setSubmitting(true)
    setModalError(null)
    setRefreshNotice(null)
    refreshRecoveryRef.current = null
    const scope = `edit:${editingItem.id}`
    const mutationKey = getMutationKey(scope, body)
    try {
      let res: Response
      try {
        res = await fetch(`/api/wishlist/${editingItem.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': mutationKey,
          },
          body,
        })
      } catch {
        setModalError(t('wishlist.writeUncertain'))
        return
      }
      if (!res.ok) {
        const details = await serverErrorDetails(res)
        if (!isDefinitiveRefusal(res.status, details))
          setModalError(t('wishlist.writeUncertain'))
        else {
          clearMutationKey(scope)
          setModalError(t('wishlist.errorSave'))
        }
        return
      }
      const confirmed = responseMatchesDraft(
        await res.json().catch(() => null),
        editingItem,
        payload,
      )
      if (!confirmed) {
        setModalError(t('wishlist.writeUncertain'))
        return
      }
      clearMutationKey(scope)
      setItems((current) =>
        current.map((item) => (item.id === confirmed.id ? confirmed : item)),
      )
      await refreshAfterConfirmedWrite('saved', confirmed)
      setEditingItem(null)
    } catch {
      setModalError(t('wishlist.writeUncertain'))
    } finally {
      setSubmitting(false)
    }
  }

  const closeAddModal = () => {
    if (submitting) return
    clearMutationKey('add')
    setModalError(null)
    setShowAddModal(false)
    setFormTitle('')
    setFormLink('')
    setFormDescription('')
    setFormPrice('')
  }

  const closeEditModal = () => {
    if (submitting) return
    if (editingItem) clearMutationKey(`edit:${editingItem.id}`)
    setModalError(null)
    setEditingItem(null)
  }

  const closeDeleteModal = () => {
    if (submitting) return
    if (deletingItem) clearMutationKey(`delete:${deletingItem.id}`)
    setModalError(null)
    setDeletingItem(null)
  }

  const isParent = userRole === 'parent'
  const visibleItems = isParent
    ? items
    : items.filter((item) => item.requested_by === userId)
  const groupedItems = visibleItems.reduce<
    Record<string, { requester: WishlistItem['requester']; items: WishlistItem[] }>
  >((acc, item) => {
      const key = item.requester.id
      if (!acc[key]) acc[key] = { requester: item.requester, items: [] }
      acc[key].items.push(item)
      return acc
    },
    {},
  )
  const readyCount = visibleItems.filter(
    (item) => item.status === 'idle',
  ).length
  const statusMeta: Record<
    WishlistStatus,
    { label: string; color: string; dot: string }
  > = {
    idle: {
      label: t('wishlist.status.idle'),
      color: 'text-label-secondary',
      dot: 'bg-label-tertiary',
    },
    on_the_way: {
      label: t('wishlist.status.onTheWay'),
      color: 'text-primary',
      dot: 'bg-primary',
    },
    received: {
      label: t('wishlist.status.received'),
      color: 'text-success-text',
      dot: 'bg-success',
    },
    denied: {
      label: t('wishlist.status.denied'),
      color: 'text-danger-text',
      dot: 'bg-danger-fill',
    },
  }

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center px-4">
        <p className="text-subhead text-label-secondary" role="status">
          {t('wishlist.loading')}
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto flex min-h-64 max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-subhead text-danger-text" role="alert">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void fetchItems()}
          className="btn-filled min-h-11 rounded-xl px-5 text-body font-semibold"
        >
          {t('wishlist.retry')}
        </button>
      </div>
    )
  }

  const pageTitle = isParent
    ? t('wishlist.familyTitle')
    : t('wishlist.myIdeas')
  const pageSubtitle = isParent
    ? t('wishlist.familySubtitle')
    : t('wishlist.myIdeasSubtitle')

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="mb-1 text-caption-1 font-semibold uppercase tracking-[0.16em] text-label-tertiary">
              {t('wishlist.eyebrow')}
            </p>
            <h1 className="text-large-title font-display text-label-primary">
              {pageTitle}
            </h1>
            <p className="mt-1 max-w-2xl text-subhead text-label-secondary">
              {pageSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setModalError(null)
              setShowAddModal(true)
            }}
            className="btn-filled inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-body font-semibold"
          >
            <Plus size={18} aria-hidden="true" />
            {t('wishlist.addWish')}
          </button>
        </header>

        <div
          className="grid gap-3 sm:grid-cols-2"
          aria-label={t('wishlist.summaryLabel')}
        >
          <div className="card-apple p-4">
            <p className="text-caption-1 font-semibold uppercase tracking-wide text-label-tertiary">
              {t('wishlist.totalLabel')}
            </p>
            <p className="mt-1 text-title-2 font-semibold text-label-primary">
              {t(visibleItems.length === 1 ? 'wishlist.totalSummaryOne' : 'wishlist.totalSummary', { count: visibleItems.length })}
            </p>
          </div>
          <div className="card-apple p-4">
            <p className="text-caption-1 font-semibold uppercase tracking-wide text-label-tertiary">
              {t('wishlist.readyLabel')}
            </p>
            <p className="mt-1 text-title-2 font-semibold text-label-primary">
              {t(readyCount === 1 ? 'wishlist.readySummaryOne' : 'wishlist.readySummary', { count: readyCount })}
            </p>
          </div>
        </div>

        {refreshNotice && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-2xl border border-[var(--accent-tint-strong)] bg-[var(--accent-tint)] p-4 text-body text-label-primary sm:flex-row sm:items-center sm:justify-between"
          >
            <span>
              {t(
                refreshNotice === 'deleted'
                  ? 'wishlist.deletedRefreshFailed'
                  : refreshNotice === 'status'
                    ? 'wishlist.statusSavedRefreshFailed'
                    : 'wishlist.savedRefreshFailed',
              )}
            </span>
            <button
              type="button"
              onClick={() => void retryRefresh()}
              className="min-h-11 shrink-0 rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-4 text-body font-semibold"
            >
              {t('wishlist.retry')}
            </button>
          </div>
        )}

        {visibleItems.length === 0 && (
          <div className="card-apple flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--surface-fill)]">
              <Heart
                className="text-label-tertiary"
                size={28}
                aria-hidden="true"
              />
            </div>
            <h2 className="text-title-2 font-semibold text-label-primary">
              {t('wishlist.empty')}
            </h2>
            <p className="mt-1 max-w-md text-subhead text-label-secondary">
              {t(
                !isParent
                  ? 'wishlist.emptyMineSubtitle'
                  : 'wishlist.emptySubtitle',
              )}
            </p>
          </div>
        )}

        {Object.entries(groupedItems).map(
          ([requesterId, { requester, items: requesterItems }]) => (
            <section
              key={requesterId}
              aria-labelledby={`wishlist-${requesterId}`}
            >
              {isParent && (
                <h2
                  id={`wishlist-${requesterId}`}
                  className="mb-3 ml-1 text-caption-1 font-semibold uppercase tracking-wide text-label-tertiary"
                >
                  {t('wishlist.wishesFor', { name: requester.name })}
                </h2>
              )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {requesterItems.map((item) => {
                const meta = statusMeta[item.status]
                const canManage = isParent || item.requested_by === userId
                const statusPending = pendingStatusIds.has(item.id)
                return (
                  <article
                    key={item.id}
                    className="flex min-h-48 flex-col rounded-2xl bg-[var(--surface-elevated)] p-5 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start gap-2">
                          <h3 className="min-w-0 break-words text-headline font-semibold text-label-primary">
                            {item.title}
                          </h3>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 text-caption-1 font-medium ${meta.color}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}
                              aria-hidden="true"
                            />
                            {meta.label}
                          </span>
                        </div>
                        {item.link && (
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={item.link}
                            title={item.link}
                            className="mt-2 inline-flex max-w-full items-start gap-1 break-all text-caption-1 text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                          >
                            <ExternalLink
                              size={14}
                              className="mt-0.5 shrink-0"
                              aria-hidden="true"
                            />
                            <span>{item.link}</span>
                          </a>
                        )}
                      </div>
                      {isParent && (
                        <select
                          ref={(node) => {
                            if (node)
                              statusSelectRefs.current.set(item.id, node)
                            else statusSelectRefs.current.delete(item.id)
                          }}
                          value={item.status}
                          disabled={submitting || statusPending}
                          aria-busy={statusPending || undefined}
                          onChange={(event) => {
                            if (event.target.value === 'denied')
                              openDenialModal(item)
                            else
                              void handleStatusChange(
                                item.id,
                                event.target.value,
                              )
                          }}
                          aria-label={t('wishlist.statusFor', {
                            title: item.title,
                          })}
                          className="min-h-11 max-w-32 rounded-lg border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-2 py-1 text-caption-1 text-label-primary disabled:opacity-60"
                        >
                          <option value="idle">
                            {t('wishlist.status.idle')}
                          </option>
                          <option value="on_the_way">
                            {t('wishlist.status.onTheWay')}
                          </option>
                          <option value="received">
                            {t('wishlist.status.received')}
                          </option>
                          <option value="denied">
                            {t('wishlist.status.denied')}
                          </option>
                        </select>
                      )}
                    </div>
                    {item.description && (
                      <p className="mt-3 whitespace-pre-wrap break-words text-subhead text-label-secondary">
                        {item.description}
                      </p>
                    )}
                    {item.approx_price && (
                      <p className="mt-3 text-callout text-label-secondary">
                        {t('wishlist.approxPriceValue', {
                          value: item.approx_price,
                        })}
                      </p>
                    )}
                    {item.status === 'denied' && item.denied_reason && (
                      <p className="mt-3 break-words text-caption-1 italic text-danger-text">
                        {t('wishlist.deniedReason')}: {item.denied_reason}
                      </p>
                    )}
                    {canManage && (
                      <div className="mt-auto flex justify-end gap-2 pt-4">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          aria-label={t('wishlist.editItem', {
                            title: item.title,
                          })}
                          className="btn-ghost inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-0"
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setModalError(null)
                            setDeletingItem(item)
                          }}
                          aria-label={t('wishlist.deleteItem', {
                            title: item.title,
                          })}
                          className="btn-ghost inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-0 text-danger-text"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
            </section>
          ),
        )}
      </div>

      <Dialog
        open={!!denialDraft}
        onClose={closeDenialModal}
        title={t('wishlist.denyWish')}
        description={denialDraft?.title}
        initialFocusRef={denialReasonRef}
        closeLabel={t('wishlist.cancel')}
      >
        <div className="space-y-4">
          <label
            htmlFor="wishlist-denial-reason"
            className="block text-callout font-medium"
          >
            {t('wishlist.deniedReason')}
          </label>
          <textarea
            ref={denialReasonRef}
            id="wishlist-denial-reason"
            value={denialDraft?.reason ?? ''}
            onChange={(event) =>
              setDenialDraft((current) =>
                current ? { ...current, reason: event.target.value } : current,
              )
            }
            maxLength={500}
            rows={3}
            placeholder={t('wishlist.denialReasonPlaceholder')}
            className="min-h-24 w-full resize-none rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-4 py-3 text-body focus:border-[var(--focus-ring)] focus:outline-none"
          />
          {statusModalError && (
            <p role="alert" className="text-footnote text-danger-text">
              {statusModalError}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={closeDenialModal}
              disabled={Boolean(
                denialDraft && pendingStatusIds.has(denialDraft.itemId),
              )}
              className="btn-ghost min-h-11 flex-1 rounded-xl text-body font-semibold disabled:opacity-50"
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
              className="btn-filled min-h-11 flex-1 rounded-xl text-body font-semibold disabled:opacity-50"
            >
              {t('wishlist.confirmDenial')}
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={showAddModal}
        onClose={closeAddModal}
        title={t('wishlist.addWish')}
        variant="form"
        closeLabel={t('wishlist.cancel')}
      >
        <fieldset
          disabled={submitting}
          className="space-y-4 disabled:opacity-80"
        >
          <div>
            <label
              htmlFor="add-wish-title"
              className="mb-1.5 block text-callout font-medium"
            >
              {t('wishlist.wishTitle')} *
            </label>
            <input
              id="add-wish-title"
              type="text"
              value={formTitle}
              onChange={(event) => setFormTitle(event.target.value)}
              placeholder={t('wishlist.titlePlaceholder')}
              required
              className="w-full rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-4 py-3 text-body focus:border-[var(--focus-ring)] focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="add-wish-link"
              className="mb-1.5 block text-callout font-medium"
            >
              {t('wishlist.link')}
            </label>
            <input
              id="add-wish-link"
              type="url"
              value={formLink}
              onChange={(event) => setFormLink(event.target.value)}
              placeholder={t('wishlist.linkPlaceholder')}
              className="w-full rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-4 py-3 text-body focus:border-[var(--focus-ring)] focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="add-wish-description"
              className="mb-1.5 block text-callout font-medium"
            >
              {t('wishlist.description')}
            </label>
            <textarea
              id="add-wish-description"
              value={formDescription}
              onChange={(event) => setFormDescription(event.target.value)}
              placeholder={t('wishlist.descriptionPlaceholder')}
              rows={3}
              className="w-full resize-none rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-4 py-3 text-body focus:border-[var(--focus-ring)] focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="add-wish-price"
              className="mb-1.5 block text-callout font-medium"
            >
              {t('wishlist.approxPrice')}
            </label>
            <input
              id="add-wish-price"
              type="number"
              inputMode="decimal"
              value={formPrice}
              onChange={(event) => setFormPrice(event.target.value)}
              placeholder={t('wishlist.pricePlaceholder')}
              step="0.01"
              min="0"
              className="w-full rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-4 py-3 text-body focus:border-[var(--focus-ring)] focus:outline-none"
            />
          </div>
          {modalError && (
            <p role="alert" className="text-footnote text-danger-text">
              {modalError}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={closeAddModal}
              disabled={submitting}
              className="btn-ghost min-h-11 flex-1 rounded-xl text-body font-semibold disabled:opacity-50"
            >
              {t('wishlist.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleAddWish()}
              disabled={submitting || !formTitle.trim()}
              className="btn-filled min-h-11 flex-1 rounded-xl text-body font-semibold disabled:opacity-50"
            >
              {submitting ? t('common.saving') : t('wishlist.save')}
            </button>
          </div>
        </fieldset>
      </Dialog>

      <Dialog
        open={!!editingItem}
        onClose={closeEditModal}
        title={t('wishlist.edit')}
        variant="form"
        closeLabel={t('wishlist.cancel')}
      >
        <fieldset
          disabled={submitting}
          className="space-y-4 disabled:opacity-80"
        >
          <div>
            <label
              htmlFor="edit-wish-name"
              className="mb-1.5 block text-callout font-medium"
            >
              {t('wishlist.wishTitle')} *
            </label>
            <input
              id="edit-wish-name"
              type="text"
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              required
              className="w-full rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-4 py-3 text-body focus:border-[var(--focus-ring)] focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="edit-wish-link"
              className="mb-1.5 block text-callout font-medium"
            >
              {t('wishlist.link')}
            </label>
            <input
              id="edit-wish-link"
              type="url"
              value={editLink}
              onChange={(event) => setEditLink(event.target.value)}
              className="w-full rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-4 py-3 text-body focus:border-[var(--focus-ring)] focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="edit-wish-description"
              className="mb-1.5 block text-callout font-medium"
            >
              {t('wishlist.description')}
            </label>
            <textarea
              id="edit-wish-description"
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-4 py-3 text-body focus:border-[var(--focus-ring)] focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="edit-wish-price"
              className="mb-1.5 block text-callout font-medium"
            >
              {t('wishlist.approxPrice')}
            </label>
            <input
              id="edit-wish-price"
              type="number"
              inputMode="decimal"
              value={editPrice}
              onChange={(event) => setEditPrice(event.target.value)}
              step="0.01"
              min="0"
              className="w-full rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-4 py-3 text-body focus:border-[var(--focus-ring)] focus:outline-none"
            />
          </div>
          {modalError && (
            <p role="alert" className="text-footnote text-danger-text">
              {modalError}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={closeEditModal}
              disabled={submitting}
              className="btn-ghost min-h-11 flex-1 rounded-xl text-body font-semibold disabled:opacity-50"
            >
              {t('wishlist.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleEdit()}
              disabled={submitting || !editTitle.trim()}
              className="btn-filled min-h-11 flex-1 rounded-xl text-body font-semibold disabled:opacity-50"
            >
              {submitting ? t('common.saving') : t('wishlist.save')}
            </button>
          </div>
        </fieldset>
      </Dialog>

      <Dialog
        open={!!deletingItem}
        onClose={closeDeleteModal}
        title={t('wishlist.delete')}
        description={deletingItem?.title}
        role="alertdialog"
        closeLabel={t('wishlist.cancel')}
      >
        <div className="space-y-3">
          {modalError && (
            <p role="alert" className="text-footnote text-danger-text">
              {modalError}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={closeDeleteModal}
              disabled={submitting}
              className="btn-ghost min-h-11 flex-1 rounded-xl text-body font-semibold disabled:opacity-50"
            >
              {t('wishlist.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={submitting}
              className="min-h-11 flex-1 rounded-xl bg-danger-fill py-3 text-body font-semibold text-white disabled:opacity-50"
            >
              {submitting ? t('common.saving') : t('wishlist.delete')}
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
