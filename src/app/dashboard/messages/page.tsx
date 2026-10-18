'use client'

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { Send, MessageSquare } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Glyph } from '@/components/ui/glyph'
import { EmptyState } from '@/components/ui/empty-state'
import { ILLUSTRATIONS } from '@/lib/brand-illustrations'
import { FeatureGate } from '@/components/ui/feature-gate'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import { useMessagesText } from '@/i18n/messages'
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from '@/lib/idempotency-key'
import { mergeLatest, prependEarlier } from './thread'

/** GET /api/messages page size (the route's default). */
const PAGE_SIZE = 50
/** Within this many pixels of the bottom counts as reading the newest messages. */
const NEAR_BOTTOM_PX = 120

interface ChatMessage {
  id: string
  created_at: string
  content: string
  sender_id: string
  sender?: { id: string; name: string; avatar_url?: string | null } | null
}

interface Member {
  id: string
  name: string
}

interface SendIntent {
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
  return (
    typeof message.id === 'string' &&
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
    ))
  )
}

function isMember(value: unknown): value is Member {
  if (!value || typeof value !== 'object') return false
  const member = value as Record<string, unknown>
  return typeof member.id === 'string' && typeof member.name === 'string'
}

function parseMessagesResponse(value: unknown): { messages: ChatMessage[]; members: Member[]; userId: string } | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  return (
    Array.isArray(data.messages) && data.messages.every(isChatMessage) &&
    Array.isArray(data.members) && data.members.every(isMember) &&
    typeof data.userId === 'string'
  )
    ? { messages: data.messages, members: data.members, userId: data.userId }
    : null
}

function formatMessageDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-US', {
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
  const { locale } = useTranslation()
  const messageText = useMessagesText()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [familyMembers, setFamilyMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [readPending, setReadPending] = useState(false)
  const [readError, setReadError] = useState(false)
  // Older history: GET /api/messages?cursor=<oldest created_at> returns the
  // page of messages created before it.
  const [hasEarlier, setHasEarlier] = useState(false)
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
  const ambiguousSendRef = useRef(new Map<string, string>())

  const markMessagesRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    const signature = ids.join(',')
    if (markedReadSignatureRef.current === signature) return
    markedReadSignatureRef.current = signature
    const request = ++readRequestRef.current
    setReadPending(true)
    setReadError(false)
    try {
      const res = await fetch('/api/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: ids }),
      })
      if (!res.ok) throw new Error('read status')
    } catch {
      if (request === readRequestRef.current) {
        markedReadSignatureRef.current = null
        setReadError(true)
      }
    } finally {
      if (request === readRequestRef.current) setReadPending(false)
    }
  }, [])

  const loadData = useCallback(async () => {
    const request = ++latestLoadRef.current
    latestLoadPendingRef.current = true
    try {
      const res = await fetch('/api/messages')
      const data = res.ok ? parseMessagesResponse(await res.json().catch(() => null)) : null
      if (request !== latestLoadRef.current) return
      if (!res.ok || !data) {
        setLoadError(true)
        return
      }
      // Same newest message and count: keep the same array, so a quiet
      // poll neither re-renders the thread nor scrolls it.
      setMessages(prev => mergeLatest(prev, data.messages))
      if (firstLoadRef.current) {
        firstLoadRef.current = false
        setHasEarlier(data.messages.length >= PAGE_SIZE)
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
  }, [markMessagesRead])

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
    const oldest = messages[0]
    if (!oldest || loadingEarlier) return
    setLoadingEarlier(true)
    setEarlierError(false)
    try {
      const res = await fetch(`/api/messages?cursor=${encodeURIComponent(oldest.created_at)}&limit=${PAGE_SIZE}`)
      if (!res.ok) {
        setEarlierError(true)
        return
      }
      const data = await res.json().catch(() => null)
      const older: ChatMessage[] =
        data && typeof data === 'object' && Array.isArray(data.messages) && data.messages.every(isChatMessage)
          ? data.messages
          : []
      if (!data || typeof data !== 'object' || !Array.isArray(data.messages) || !data.messages.every(isChatMessage)) {
        setEarlierError(true)
        return
      }
      setHasEarlier(older.length >= PAGE_SIZE)
      if (older.length > 0) {
        prependAnchorRef.current = threadRef.current?.scrollHeight ?? null
        setMessages(prev => prependEarlier(prev, older))
      }
    } catch {
      setEarlierError(true)
    } finally {
      setLoadingEarlier(false)
    }
  }

  const retryRead = () => {
    markedReadSignatureRef.current = null
    void markMessagesRead(messages.map(message => message.id))
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = newMessage.trim()
    if (!content || sending) return

    const body = { content, type: 'text' }
    const payload = JSON.stringify(body)
    const current = sendIntentRef.current
    const key = current?.payload === payload
      ? current.key
      : ambiguousSendRef.current.get(payload) ?? newIdempotencyKey()
    sendIntentRef.current = { payload, key }

    setSending(true)
    setSendError(null)
    try {
      let res: Response
      try {
        res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key },
          body: payload,
        })
      } catch {
        // The typed text and key stay in place so the same intent can be sent again.
        ambiguousSendRef.current.set(payload, key)
        setSendError(messageText('sendNetworkError'))
        return
      }
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500 && res.status !== 409) {
          ambiguousSendRef.current.delete(payload)
          if (sendIntentRef.current?.payload === payload) sendIntentRef.current = null
        } else {
          ambiguousSendRef.current.set(payload, key)
        }
        setSendError(messageText('sendFailed'))
        return
      }
      if (!data || !isChatMessage(data.message)) {
        ambiguousSendRef.current.set(payload, key)
        setSendError(messageText('sendUnconfirmed'))
        return
      }
      justSentRef.current = true
      setMessages(prev => (prev.some(m => m.id === data.message.id) ? prev : [...prev, data.message]))
      setNewMessage('')
      ambiguousSendRef.current.delete(payload)
      if (sendIntentRef.current?.payload === payload) sendIntentRef.current = null
    } finally {
      setSending(false)
    }
  }

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
                    </div>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>

        <div className="border-t border-[var(--surface-separator)] px-4 py-3 bg-[var(--surface-base)]">
          <form onSubmit={handleSendMessage} className="flex items-center gap-2">
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
              disabled={sending || !newMessage.trim()}
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

          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {sending ? messageText('sending') : ''}
          </div>
        </div>
      </div>
    </div>
  )
}
