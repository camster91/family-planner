'use client'

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { ImagePlus, Link2, Send, MessageSquare, X } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { Glyph } from '@/components/ui/glyph'
import { EmptyState } from '@/components/ui/empty-state'
import { ILLUSTRATIONS } from '@/lib/brand-illustrations'
import { FeatureGate } from '@/components/ui/feature-gate'
import { cn } from '@/lib/utils'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import { useMessagesText } from '@/i18n/messages'
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from '@/lib/idempotency-key'
import { mergeLatest, prependEarlier } from './thread'
import { MESSAGE_OWNER_HEADER, messageSendWindowOpen, parseMessageWriteContext, type MessageWriteContext } from '@/lib/message-owner-contract'
import { requestOwnedJson, runOwnedForeground } from '@/lib/owned-request-http'
import { readBoundedJsonResponse } from '@/lib/bounded-json-response'

/** GET /api/messages page size (the route's default). */
const PAGE_SIZE = 50
/** Within this many pixels of the bottom counts as reading the newest messages. */
const NEAR_BOTTOM_PX = 120
const MAX_MESSAGE_ATTACHMENTS = 8
const MAX_MESSAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024

interface ChatMessage {
  id: string
  created_at: string
  content: string
  sender_id: string
  sender?: { id: string; name: string; avatar_url?: string | null } | null
  pickup?: ChatPickup | null
  attachments?: string[]
}

interface ChatPickup {
  id: string
  title: string
  pickup_time: string
  completed: boolean
  assignee?: { id: string; name: string } | null
}

interface PickupOption {
  id: string
  title: string
  pickup_time: string
  completed: boolean
}

interface PendingAttachment {
  file: File
  id?: string
}

interface Member {
  id: string
  name: string
}

interface SendIntent {
  draft: string
  issuedAt: string
  payload: string
  key: string
}

function sameIds(a: { id: string }[], b: { id: string }[]): boolean {
  return a.length === b.length && a.every((m, i) => m.id === b[i]?.id)
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  const sender = message.sender
  const pickup = message.pickup
  const assignee = pickup && typeof pickup === 'object' ? (pickup as Record<string, unknown>).assignee : undefined
  const attachments = message.attachments
  return (
    typeof message.id === 'string' && message.id.length > 0 &&
    typeof message.created_at === 'string' &&
    !Number.isNaN(Date.parse(message.created_at)) &&
    typeof message.content === 'string' &&
    typeof message.sender_id === 'string' &&
    (sender === undefined || sender === null || (
      typeof sender === 'object' &&
      typeof (sender as Record<string, unknown>).id === 'string' &&
      typeof (sender as Record<string, unknown>).name === 'string' &&
      ((sender as Record<string, unknown>).avatar_url === undefined ||
        (sender as Record<string, unknown>).avatar_url === null ||
        typeof (sender as Record<string, unknown>).avatar_url === 'string')
    )) &&
    (pickup === undefined || pickup === null || (
      typeof pickup === 'object' &&
      typeof (pickup as Record<string, unknown>).id === 'string' &&
      typeof (pickup as Record<string, unknown>).title === 'string' &&
      typeof (pickup as Record<string, unknown>).pickup_time === 'string' &&
      !Number.isNaN(Date.parse((pickup as Record<string, unknown>).pickup_time as string)) &&
      typeof (pickup as Record<string, unknown>).completed === 'boolean' &&
      (assignee === undefined || assignee === null || (
        typeof assignee === 'object' &&
        typeof (assignee as Record<string, unknown>).id === 'string' &&
        typeof (assignee as Record<string, unknown>).name === 'string'
      ))
    )) &&
    (attachments === undefined || (
      Array.isArray(attachments) && attachments.every((attachment) => isMessageAttachmentUrl(attachment))
    ))
  )
}

function isMessageAttachmentUrl(value: unknown): value is string {
  return typeof value === 'string' && /^\/api\/messages\/attachments\/[A-Za-z0-9._~%-]+$/.test(value)
}

function isPickupOption(value: unknown): value is PickupOption {
  if (!value || typeof value !== 'object') return false
  const pickup = value as Record<string, unknown>
  return (
    typeof pickup.id === 'string' &&
    typeof pickup.title === 'string' &&
    typeof pickup.pickup_time === 'string' &&
    !Number.isNaN(Date.parse(pickup.pickup_time)) &&
    typeof pickup.completed === 'boolean'
  )
}

function formatPickupDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date))
}

function isMember(value: unknown): value is Member {
  if (!value || typeof value !== 'object') return false
  const member = value as Record<string, unknown>
  return typeof member.id === 'string' && typeof member.name === 'string'
}

async function readChatPage(url: string, signal: AbortSignal) {
  const result = await runOwnedForeground(async ownedSignal => {
    const response = await fetch(url, { cache: 'no-store', signal: ownedSignal })
    const data = response.ok ? await readBoundedJsonResponse(response, ownedSignal, 2 * 1024 * 1024) : null
    return { kind: 'reply' as const, response, data }
  }, { signal })
  if (result.kind === 'unknown') throw new Error('Message read unavailable')
  return result
}
function parseMessagesResponse(value: unknown): { messages: ChatMessage[]; members: Member[]; userId: string; nextCursor: string | null; pagingSupported: boolean; scope: string; writeContext: MessageWriteContext | null } | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (!Array.isArray(data.messages) || data.messages.length > PAGE_SIZE || !data.messages.every(isChatMessage) ||
    new Set(data.messages.map(row => row.id)).size !== data.messages.length ||
    !Array.isArray(data.members) || !data.members.every(isMember) || (typeof data.userId !== 'string' || !data.userId)) return null
  const pagingSupported = 'nextCursor' in data
  const cursor = pagingSupported ? data.nextCursor : null
  if (cursor !== null && (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(cursor) || data.messages.length !== PAGE_SIZE)) return null
  const context = data.readContext && typeof data.readContext === 'object' ? data.readContext as Record<string, unknown> : null
  if (pagingSupported && (!context || context.userId !== data.userId || typeof context.familyId !== 'string' || !context.familyId)) return null
  const writeContext = data.writeContext === undefined ? null : parseMessageWriteContext(data.writeContext)
  if (data.writeContext !== undefined && (!writeContext || writeContext.userId !== data.userId || (pagingSupported && writeContext.familyId !== context!.familyId))) return null
  return { messages: data.messages, members: data.members, userId: data.userId, nextCursor: cursor as string | null, pagingSupported,
    scope: JSON.stringify([data.userId, pagingSupported ? context!.familyId : writeContext?.familyId ?? 'legacy-context']), writeContext }

}

function formatMessageDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date))
}

// Gated like the other feature pages (route inventory F-2): with Family chat
// off nothing below mounts, so it neither polls /api/messages nor shows a 403.
export default function MessagesPage() {
  return (
    <FeatureGate featureKey="messages">
      <MessagesContent />
    </FeatureGate>
  )
}

function MessagesContent() {
  const locale = useDisplayLocale()
  const messageText = useMessagesText()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [familyMembers, setFamilyMembers] = useState<Member[]>([])
  const [pickups, setPickups] = useState<PickupOption[]>([])
  const [selectedPickupId, setSelectedPickupId] = useState('')
  const [showPickupPicker, setShowPickupPicker] = useState(false)
  const [pickupLoading, setPickupLoading] = useState(false)
  const [pickupLoaded, setPickupLoaded] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [blockedIntent, setBlockedIntent] = useState<SendIntent | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [readPending, setReadPending] = useState(false)
  const [readError, setReadError] = useState(false)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  // Opaque continuation belongs to the first successfully loaded thread.
  // Newest refreshes must not replace an older-history retry position.
  const [hasEarlier, setHasEarlier] = useState(false)
  const [historyUnavailable, setHistoryUnavailable] = useState(false)
  const [contextChanged, setContextChanged] = useState(false)
  const retired = useRef(false)
  const writeContext = useRef<MessageWriteContext | null>(null)
  const [writeUnavailable, setWriteUnavailable] = useState(true)
  const readScope = useRef<string | null>(null)
  const earlierCursor = useRef<string | null>(null)
  const seenHistoryCursors = useRef(new Set<string>())
  const earlierRequest = useRef(0)
  const earlierLock = useRef(false)
  const latestAbort = useRef<AbortController | null>(null)
  const earlierAbort = useRef<AbortController | null>(null)
  const earlierTrigger = useRef<HTMLButtonElement>(null)
  const restoreEarlierFocus = useRef(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [earlierError, setEarlierError] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)
  // Start pinned to the bottom; scrolling up to read history unpins.
  const nearBottomRef = useRef(true)
  const justSentRef = useRef(false)
  const firstLoadRef = useRef(true)
  // Thread scroll height just before earlier messages are put in front.
  const prependAnchorRef = useRef<number | null>(null)
  const latestLoadRef = useRef(0)
  const latestLoadPendingRef = useRef(false)
  const markedReadSignatureRef = useRef<string | null>(null)
  const readRequestRef = useRef(0)
  // One body/key pair represents one logical send. Ambiguous outcomes stay in
  // this map so editing away and back to a draft still retries the same write.
  const sendIntentRef = useRef<SendIntent | null>(null)
  const ambiguousSendRef = useRef(new Map<string, SendIntent>())

  const retireThread = useCallback(() => {
    retired.current = true
    latestLoadRef.current++; earlierRequest.current++
    latestAbort.current?.abort(); earlierAbort.current?.abort()
    // Hide all old household content/drafts. Memory is retained until an explicit
    // reload; no pending send is rebound or replayed into the changed context.
    setContextChanged(true)
  }, [])

  const markMessagesRead = useCallback(async (ids: string[]) => {
    if (retired.current || ids.length === 0) return
    const signature = ids.join(',')
    if (markedReadSignatureRef.current === signature) return
    markedReadSignatureRef.current = signature
    const request = ++readRequestRef.current
    setReadPending(true)
    setReadError(false)
    try {
      const result = await requestOwnedJson('/api/messages', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageIds: ids }),
      }, 32 * 1024)
      if (result.kind === 'unknown' || !result.response.ok) {
        if (result.kind === 'reply' && [401, 403].includes(result.response.status)) { retireThread(); return }
        throw new Error('Read status unavailable')
      }
    } catch {
      if (request === readRequestRef.current) {
        markedReadSignatureRef.current = null
        setReadError(true)
      }
    } finally {
      if (request === readRequestRef.current) setReadPending(false)
    }
  }, [retireThread])

  const loadData = useCallback(async () => {
    if (retired.current) return
    const request = ++latestLoadRef.current
    latestAbort.current?.abort()
    const controller = new AbortController()
    latestAbort.current = controller
    latestLoadPendingRef.current = true
    try {
      const result = await readChatPage(`/api/messages?paging=keyset-v1&limit=${PAGE_SIZE}`, controller.signal)
      const res = result.response
      if (request !== latestLoadRef.current || retired.current) return
      if ([401, 403].includes(res.status)) { retireThread(); return }
      const data = res.ok ? parseMessagesResponse(result.data) : null
      if (request !== latestLoadRef.current) return
      if (!res.ok || !data) {
        setLoadError(true)
        return
      }
      if (readScope.current !== null && (readScope.current !== data.scope || JSON.stringify(writeContext.current) !== JSON.stringify(data.writeContext))) { retireThread(); return }
      readScope.current = data.scope
      writeContext.current = data.writeContext
      setWriteUnavailable(data.writeContext === null)
      // Keep loaded same-time history outside this precise newest window.
      setMessages(prev => mergeLatest(prev, data.messages, data.pagingSupported))
      if (firstLoadRef.current) {
        firstLoadRef.current = false
        earlierCursor.current = data.nextCursor
        setHasEarlier(data.nextCursor !== null)
        setHistoryUnavailable(!data.pagingSupported)
      }
      setFamilyMembers(prev => (sameIds(prev, data.members) ? prev : data.members))
      setCurrentUserId(data.userId)
      setLoadError(false)
      void markMessagesRead(data.messages.map(message => message.id))
    } catch {
      if (request === latestLoadRef.current) setLoadError(true)
    } finally {
      if (request === latestLoadRef.current) {
        latestLoadPendingRef.current = false
        setLoading(false)
      }
    }
  }, [markMessagesRead, retireThread])

  useEffect(() => {
    void loadData()
    const interval = setInterval(() => {
      if (!latestLoadPendingRef.current) void loadData()
    }, 5000)
    return () => {
      clearInterval(interval)
      latestLoadRef.current += 1
      latestLoadPendingRef.current = false
      readRequestRef.current += 1
      earlierRequest.current += 1
      latestAbort.current?.abort(); earlierAbort.current?.abort()
    }
  }, [loadData])

  const newestId = messages.length > 0 ? messages[messages.length - 1].id : null

  // Earlier messages went in front: keep the same message under the reader's eye.
  useLayoutEffect(() => {
    const el = threadRef.current
    if (el && prependAnchorRef.current !== null) {
      el.scrollTop += el.scrollHeight - prependAnchorRef.current
      prependAnchorRef.current = null
    }
  }, [messages])

  // A new newest message: follow it only when the reader is already at the
  // bottom or just sent it, so someone reading history is never yanked away.
  useEffect(() => {
    if (!newestId) return
    const el = threadRef.current
    if (!el || !(nearBottomRef.current || justSentRef.current)) return
    justSentRef.current = false
    nearBottomRef.current = true
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })
    else el.scrollTop = el.scrollHeight
  }, [newestId])

  const handleScroll = () => {
    const el = threadRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
  }

  const loadEarlier = async () => {
    const cursor = earlierCursor.current
    if (retired.current || !cursor || earlierLock.current) return
    earlierLock.current = true
    const request = ++earlierRequest.current
    const scope = readScope.current
    const controller = new AbortController()
    earlierAbort.current = controller
    restoreEarlierFocus.current = document.activeElement === earlierTrigger.current
    setLoadingEarlier(true)
    setEarlierError(false)
    try {
      const query = new URLSearchParams({ paging: 'keyset-v1', limit: String(PAGE_SIZE), cursor })
      const { response, data: body } = await readChatPage(`/api/messages?${query}`, controller.signal)
      if (request !== earlierRequest.current || retired.current) return
      if ([401, 403].includes(response.status)) { retireThread(); return }
      const data = response.ok ? parseMessagesResponse(body) : null
      if (!data || !data.pagingSupported) throw new Error('History unavailable')
      if (data.scope !== scope || scope !== readScope.current || JSON.stringify(data.writeContext) !== JSON.stringify(writeContext.current)) { retireThread(); return }
      if (data.nextCursor && (data.nextCursor === cursor || seenHistoryCursors.current.has(data.nextCursor))) throw new Error('Repeated history position')
      seenHistoryCursors.current.add(cursor)
      earlierCursor.current = data.nextCursor
      setHasEarlier(data.nextCursor !== null)
      if (data.messages.length > 0) {
        prependAnchorRef.current = threadRef.current?.scrollHeight ?? null
        setMessages(prev => prependEarlier(prev, data.messages))
      }
    } catch {
      if (request === earlierRequest.current && !retired.current) setEarlierError(true)
    } finally {
      if (request === earlierRequest.current) {
        earlierLock.current = false
        setLoadingEarlier(false)
      }
    }
  }
  useEffect(() => {
    if (loadingEarlier || !restoreEarlierFocus.current) return
    restoreEarlierFocus.current = false
    if (document.activeElement !== document.body && document.activeElement !== earlierTrigger.current) return
    ;(hasEarlier ? earlierTrigger.current : threadRef.current)?.focus({ preventScroll: true })
  }, [loadingEarlier, hasEarlier, earlierError])

  const retryRead = () => {
    markedReadSignatureRef.current = null
    void markMessagesRead(messages.map(message => message.id))
  }

  const togglePickupPicker = async () => {
    const nextVisible = !showPickupPicker
    setShowPickupPicker(nextVisible)
    if (!nextVisible || pickupLoaded || pickupLoading) return
    setPickupLoading(true)
    try {
      const response = await fetch('/api/pickups', { cache: 'no-store' })
      const data = response.ok ? await response.json().catch(() => null) : null
      if (data && typeof data === 'object' && Array.isArray(data.pickups)) {
        setPickups(data.pickups.filter(isPickupOption))
      }
    } catch {
      // Linking is optional. Do not turn a healthy message thread into an
      // error state when the separate Pickups feature is unavailable.
    } finally {
      setPickupLoaded(true)
      setPickupLoading(false)
    }
  }

  const handleAttachmentSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (selected.length === 0) return
    if (pendingAttachments.length + selected.length > MAX_MESSAGE_ATTACHMENTS) {
      setSendError(messageText('photoUploadFailed'))
      return
    }
    const valid = selected.filter((file) => (
      ['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(file.type) &&
      file.size <= MAX_MESSAGE_ATTACHMENT_BYTES
    ))
    if (valid.length !== selected.length) {
      setSendError(messageText('photoUploadFailed'))
      return
    }
    setPendingAttachments((current) => [...current, ...valid.map((file) => ({ file }))])
    setSendError(null)
  }

  const removeAttachment = (index: number) => {
    if (sending) return
    setPendingAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const uploadPendingAttachments = async (items: PendingAttachment[], owner: MessageWriteContext): Promise<string[] | null> => {
    const uploaded = [...items]
    for (let index = 0; index < uploaded.length; index += 1) {
      if (retired.current || JSON.stringify(writeContext.current) !== JSON.stringify(owner)) return null
      const item = uploaded[index]
      if (item.id) continue
      const formData = new FormData()
      formData.append('file', item.file)
      let result: Awaited<ReturnType<typeof requestOwnedJson>>
      try {
        result = await requestOwnedJson('/api/messages/attachments/owned', { method: 'POST', headers: { [MESSAGE_OWNER_HEADER]: JSON.stringify(owner) }, body: formData }, 32 * 1024)
      } catch {
        setSendError(messageText('photoUploadFailed')); return null
      }
      if (result.kind === 'unknown') { setSendError(messageText('photoUploadFailed')); return null }
      const { response, body: data } = result
      if (retired.current || JSON.stringify(writeContext.current) !== JSON.stringify(owner)) return null
      if ([401, 403].includes(response.status) || (data && typeof data === 'object' && 'code' in data && data.code === 'MESSAGE_OWNER_CHANGED')) { retireThread(); return null }
      const id = data && typeof data === 'object' && 'attachment' in data && data.attachment && typeof data.attachment === 'object'
        ? (data.attachment as Record<string, unknown>).id
        : null
      if (!response.ok || typeof id !== 'string' || id.length === 0) {
        setSendError(messageText('photoUploadFailed'))
        return null
      }
      uploaded[index] = { ...item, id }
      setPendingAttachments([...uploaded])
    }
    return uploaded.map((item) => item.id).filter((id): id is string => Boolean(id))
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = newMessage.trim()
    if (!content || sending || retired.current) return
    const owner = writeContext.current ? { ...writeContext.current } : null
    if (!owner) { setSendError(messageText('writeUnavailable')); return }

    setSending(true)
    setSendError(null)
    const attachmentIds = await uploadPendingAttachments(pendingAttachments, owner)
    if (attachmentIds === null || retired.current || JSON.stringify(writeContext.current) !== JSON.stringify(owner)) {
      setSending(false)
      return
    }
    const body = {
      content,
      type: 'text',
      pickup_id: selectedPickupId || null,
      attachment_ids: attachmentIds,
      expected_user_id: owner.userId,
      expected_family_id: owner.familyId,
      expected_generation: owner.generation,
    }
    const draft = JSON.stringify(body)
    const current = sendIntentRef.current
    const issuedAt = new Date().toISOString()
    const intent = (current?.draft === draft ? current : ambiguousSendRef.current.get(draft)) ?? {
      draft, issuedAt, payload: JSON.stringify({ ...body, issued_at: issuedAt }), key: newIdempotencyKey(),
    }
    const { payload, key } = intent
    sendIntentRef.current = intent
    setBlockedIntent(null)
    if (!messageSendWindowOpen(intent.issuedAt)) {
      ambiguousSendRef.current.set(draft, intent)
      setBlockedIntent(intent)
      setSendError(messageText('sendWindowClosed'))
      setSending(false)
      return
    }

    try {
      const result = await requestOwnedJson('/api/messages/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key }, body: payload,
      }, 256 * 1024)
      if (result.kind === 'unknown') {
        ambiguousSendRef.current.set(draft, intent)
        setSendError(messageText('sendNetworkError')); return
      }
      const { response: res, body: data } = result
      if (retired.current || JSON.stringify(writeContext.current) !== JSON.stringify(owner)) return
      if ([401, 403].includes(res.status) || (data && typeof data === 'object' && 'code' in data && data.code === 'MESSAGE_OWNER_CHANGED')) { retireThread(); return }
      if (!res.ok) {
        if (data && typeof data === 'object' && 'code' in data && data.code === 'MESSAGE_SEND_WINDOW_CLOSED') {
          ambiguousSendRef.current.set(draft, intent)
          setBlockedIntent(intent)
          setSendError(messageText('sendWindowClosed'))
          return
        }
        if (res.status >= 400 && res.status < 500 && ![408, 409, 425, 429].includes(res.status)) {
          ambiguousSendRef.current.delete(draft)
          if (sendIntentRef.current?.payload === payload) sendIntentRef.current = null
        } else {
          ambiguousSendRef.current.set(draft, intent)
        }
        setSendError(messageText('sendFailed'))
        return
      }
      if (!data || typeof data !== 'object' || !('message' in data) || !isChatMessage(data.message) || data.message.sender_id !== owner.userId) {
        ambiguousSendRef.current.set(draft, intent)
        setSendError(messageText('sendUnconfirmed'))
        return
      }
      const confirmed = data.message
      justSentRef.current = true
      setMessages(prev => (prev.some(m => m.id === confirmed.id) ? prev : [...prev, confirmed]))
      setNewMessage('')
      setSelectedPickupId('')
      setPendingAttachments([])
      ambiguousSendRef.current.delete(draft)
      if (sendIntentRef.current?.payload === payload) sendIntentRef.current = null
    } finally {
      setSending(false)
    }
  }

  if (contextChanged) return <div role="alert" className="card-apple m-4 p-5 space-y-3"><p>{messageText('contextChanged')}</p><button type="button" className="btn-tinted min-h-[44px]" onClick={() => window.location.reload()}>{messageText('reloadMessages')}</button></div>

  return (
    <div className="pb-20">
      <div className="px-4 pt-2 pb-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-large-title text-label-primary">{messageText('title')}</h1>
            <p className="text-subhead text-label-secondary mt-0.5">
              {messageText('subtitle', { count: familyMembers.length })}
            </p>
          </div>
          <Glyph color="messages" size="md">
            <MessageSquare className="w-4 h-4" />
          </Glyph>
        </div>
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {readPending ? messageText('readUpdating') : ''}
        </div>
        {readError && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--surface-fill)] px-3 py-2" role="alert" data-testid="messages-read-recovery">
            <p className="text-footnote text-label-secondary">{messageText('readError')}</p>
            <button type="button" onClick={retryRead} className="btn-tinted min-h-[44px] min-w-[44px] px-3">
              {messageText('retryRead')}
            </button>
          </div>
        )}
      </div>

      <div className="card-apple mx-4 overflow-hidden">
        <div
          ref={threadRef}
          onScroll={handleScroll}
          className="h-[calc(100vh-18rem)] overflow-y-auto"
          role="region"
          aria-label={messageText('threadLabel')}
          tabIndex={0}
        >
          {writeUnavailable && !loading && <p role="status" className="px-4 py-3 text-footnote text-label-secondary">{messageText('writeUnavailable')}</p>}
          {historyUnavailable && <p role="status" className="px-4 py-3 text-footnote text-label-secondary">{messageText('historyUnavailable')}</p>}
          {loadError && !loading && (
            <div data-testid="messages-load-error" role="alert" className="card-apple m-4 flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-body font-semibold text-label-primary">{messageText('loadErrorTitle')}</p>
                <p className="text-footnote text-label-secondary">{messageText('loadErrorDescription')}</p>
              </div>
              <button
                type="button"
                onClick={() => { setLoading(true); void loadData() }}
                disabled={loading}
                className="btn-tinted min-h-[44px] min-w-[44px]"
              >
                {loading ? messageText('refreshing') : messageText('retry')}
              </button>
            </div>
          )}
          {loading && messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-subhead text-label-secondary">{messageText('refreshing')}</div>
            </div>
          ) : !loadError && messages.length === 0 ? (
            <div className="flex items-center justify-center h-full px-4">
              <EmptyState
                icon={MessageSquare}
                glyphColor="messages"
                illustration={ILLUSTRATIONS.messagesEmpty}
                title={messageText('emptyTitle')}
                description={messageText('emptyDescription')}
              />
            </div>
          ) : messages.length > 0 ? (
            <div className="py-3">
              {hasEarlier && (
                <div className="flex flex-col items-center gap-1 px-4 pb-2">
                  <button
                    type="button"
                    ref={earlierTrigger}
                    onClick={() => void loadEarlier()}
                    disabled={loadingEarlier}
                    aria-busy={loadingEarlier || undefined}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full px-4 text-subhead font-medium text-[var(--accent-text)] hover:bg-[var(--surface-fill)] disabled:opacity-60 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
                  >
                    {loadingEarlier ? messageText('loadingEarlier') : messageText('loadEarlier')}
                  </button>
                  {earlierError && (
                    <p role="alert" className="text-footnote text-[var(--danger-text)] text-center">
                      {messageText('earlierError')}
                    </p>
                  )}
                </div>
              )}
              {messages.map((message) => {
                const isCurrentUser = message.sender_id === currentUserId
                const sender = message.sender
                const formattedDate = formatMessageDate(message.created_at, locale)
                return (
                  <div key={message.id} className="px-4 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <Avatar name={sender?.name || '?'} src={sender?.avatar_url} size="xs" />
                      <span className="text-footnote font-semibold text-label-primary">
                        {isCurrentUser ? messageText('you') : sender?.name}
                      </span>
                      <time className="text-caption-1 text-label-tertiary" dateTime={message.created_at} aria-label={messageText('dateLabel', { date: formattedDate })}>
                        {formattedDate}
                      </time>
                    </div>
                    <div
                      className={cn(
                        'ml-6 rounded-2xl px-3 py-2 max-w-[80%]',
                        isCurrentUser
                          ? 'bg-tint-messages text-white'
                          : 'bg-surface-fill text-label-primary'
                      )}
                    >
                      <p className="text-body">{message.content}</p>
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="mt-2 grid max-w-full grid-cols-2 gap-2" aria-label={messageText('photoAttachment')}>
                          {message.attachments.map((attachment) => (
                            <Image
                              key={attachment}
                              src={attachment}
                              alt={messageText('photoAttachment')}
                              width={320}
                              height={192}
                              unoptimized
                              loading="lazy"
                              className="max-h-48 w-full rounded-xl object-cover"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    {message.pickup && (
                      <Link
                        href="/dashboard/pickups"
                        className="ml-6 mt-2 inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-xl bg-surface-fill px-3 py-2 text-left text-footnote text-label-primary hover:bg-[var(--surface-elevated)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
                        aria-label={`${messageText('pickupContext')}: ${message.pickup.title}`}
                      >
                        <Link2 className="h-4 w-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{message.pickup.title}</span>
                          <time dateTime={message.pickup.pickup_time} className="block truncate text-label-secondary">
                            {formatPickupDate(message.pickup.pickup_time, locale)}
                          </time>
                        </span>
                      </Link>
                    )}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>

        <div className="border-t border-[var(--surface-separator)] px-4 py-3 bg-[var(--surface-base)]">
          {(showPickupPicker || pickups.length > 0 || pendingAttachments.length > 0) && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {showPickupPicker && pickups.length > 0 && (
                <label className="inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-xl bg-surface-fill px-3 text-footnote text-label-primary">
                  <Link2 className="h-4 w-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
                  <span className="sr-only">{messageText('linkPickup')}</span>
                  <select
                    value={selectedPickupId}
                    onChange={(event) => setSelectedPickupId(event.target.value)}
                    disabled={sending}
                    aria-label={messageText('linkPickup')}
                    className="min-w-0 max-w-[16rem] bg-transparent text-label-primary outline-none"
                  >
                    <option value="">{messageText('noPickup')}</option>
                    {pickups.map((pickup) => (
                      <option key={pickup.id} value={pickup.id}>
                        {pickup.title} · {formatPickupDate(pickup.pickup_time, locale)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {showPickupPicker && pickupLoading && (
                <span className="text-footnote text-label-secondary" role="status">
                  {messageText('refreshing')}
                </span>
              )}
              {pendingAttachments.map((attachment, index) => (
                <span key={`${attachment.file.name}-${index}`} className="inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-xl bg-surface-fill px-3 text-footnote text-label-primary">
                  <span className="max-w-[12rem] truncate">{attachment.file.name}</span>
                  {attachment.id ? <span className="text-label-secondary">✓</span> : null}
                  <button
                    type="button"
                    onClick={() => removeAttachment(index)}
                    disabled={sending}
                    className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-full text-label-secondary hover:bg-[var(--surface-elevated)] disabled:opacity-60"
                    aria-label={messageText('removePhoto')}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form onSubmit={handleSendMessage} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void togglePickupPicker()}
              disabled={sending}
              className={cn(
                'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors',
                showPickupPicker || selectedPickupId
                  ? 'bg-tint-messages text-white'
                  : 'bg-surface-fill text-label-secondary hover:bg-[var(--surface-elevated)]'
              )}
              aria-label={messageText('linkPickup')}
              aria-expanded={showPickupPicker}
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
            </button>
            <label
              className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-surface-fill text-label-secondary hover:bg-[var(--surface-elevated)] focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-[var(--accent-text)]"
              aria-label={messageText('addPhoto')}
            >
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              <input
                ref={attachmentInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                multiple
                onChange={handleAttachmentSelection}
                disabled={sending || pendingAttachments.length >= MAX_MESSAGE_ATTACHMENTS}
                className="sr-only"
                aria-label={messageText('addPhoto')}
              />
            </label>
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={messageText('messagePlaceholder')}
              className="input-apple min-h-[44px] flex-1"
              disabled={sending}
              aria-label={messageText('messageTextLabel')}
              aria-invalid={sendError ? true : undefined}
              aria-describedby={sendError ? 'message-send-error' : undefined}
            />
            <button
              type="submit"
              disabled={sending || writeUnavailable || !newMessage.trim()}
              className={cn(
                'w-11 h-11 rounded-full flex items-center justify-center transition-colors',
                newMessage.trim()
                  ? 'bg-tint-messages text-white'
                  : 'bg-surface-fill text-label-tertiary'
              )}
              aria-label={messageText('send')}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>

          {sendError && (
            <p id="message-send-error" role="alert" className="pt-2 text-footnote text-[var(--danger-text)]">
              {sendError}
            </p>
          )}

          {blockedIntent && (
            <button type="button" disabled={sending} className="btn-tinted mt-2 min-h-[44px]" onClick={() => {
              ambiguousSendRef.current.delete(blockedIntent.draft)
              if (sendIntentRef.current?.key === blockedIntent.key) sendIntentRef.current = null
              setBlockedIntent(null)
              setSendError(null)
            }}>{messageText('startNewAfterReview')}</button>
          )}

          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {sending ? messageText('sending') : ''}
          </div>
        </div>
      </div>
    </div>
  )
}
