'use client'

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { Send, Plus, MessageSquare } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Glyph } from '@/components/ui/glyph'
import { EmptyState } from '@/components/ui/empty-state'
import { ILLUSTRATIONS } from '@/lib/brand-illustrations'
import { FeatureGate } from '@/components/ui/feature-gate'
import { cn, formatDate } from '@/lib/utils'
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

/** The server's `error` text, or null when the body has none. */
async function serverError(res: Response): Promise<string | null> {
  const data = await res.json().catch(() => null)
  return data && typeof data.error === 'string' && data.error ? data.error : null
}

function sameIds(a: { id: string }[], b: { id: string }[]): boolean {
  return a.length === b.length && a.every((m, i) => m.id === b[i]?.id)
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
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [familyMembers, setFamilyMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [showAttach, setShowAttach] = useState(false)
  // Older history: GET /api/messages?cursor=<oldest created_at> returns the
  // page of messages created before it.
  const [hasEarlier, setHasEarlier] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [earlierError, setEarlierError] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  // Start pinned to the bottom; scrolling up to read history unpins.
  const nearBottomRef = useRef(true)
  const justSentRef = useRef(false)
  const firstLoadRef = useRef(true)
  // Thread scroll height just before earlier messages are put in front.
  const prependAnchorRef = useRef<number | null>(null)

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/messages')
      const data = await res.json()
      if (res.ok) {
        if (Array.isArray(data.messages)) {
          // Same newest message and count: keep the same array, so a quiet
          // poll neither re-renders the thread nor scrolls it.
          setMessages(prev => mergeLatest(prev, data.messages as ChatMessage[]))
          if (firstLoadRef.current) {
            firstLoadRef.current = false
            setHasEarlier(data.messages.length >= PAGE_SIZE)
          }
        }
        if (Array.isArray(data.members)) {
          setFamilyMembers(prev => (sameIds(prev, data.members) ? prev : data.members))
        }
        if (data.userId) setCurrentUserId(data.userId)
      }
    } catch (err) {
      console.error('Error loading data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 5000)
    return () => clearInterval(interval)
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
    setEarlierError(null)
    try {
      const res = await fetch(`/api/messages?cursor=${encodeURIComponent(oldest.created_at)}&limit=${PAGE_SIZE}`)
      if (!res.ok) {
        setEarlierError(`Couldn't load earlier messages. ${(await serverError(res)) ?? 'Please try again.'}`)
        return
      }
      const data = await res.json()
      const older: ChatMessage[] = Array.isArray(data.messages) ? data.messages : []
      setHasEarlier(older.length >= PAGE_SIZE)
      if (older.length > 0) {
        prependAnchorRef.current = threadRef.current?.scrollHeight ?? null
        setMessages(prev => prependEarlier(prev, older))
      }
    } catch {
      setEarlierError("Couldn't load earlier messages. Check your connection and try again.")
    } finally {
      setLoadingEarlier(false)
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || sending) return

    setSending(true)
    setSendError(null)
    try {
      let res: Response
      try {
        res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: newMessage.trim(), type: 'text' }),
        })
      } catch {
        // The typed text stays in the field so it can be sent again.
        setSendError("Couldn't send your message. Check your connection and try again.")
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.message) {
        const reason = typeof data?.error === 'string' && data.error ? data.error : 'Please try again.'
        setSendError(`Couldn't send your message. ${reason}`)
        return
      }
      const sent = data.message as ChatMessage
      justSentRef.current = true
      setMessages(prev => (prev.some(m => m.id === sent.id) ? prev : [...prev, sent]))
      setNewMessage('')
    } finally {
      setSending(false)
    }
  }

  // Group messages by sender for avatar+name header per message
  return (
    <div className="pb-20">
      {/* Header */}
      <div className="px-4 pt-2 pb-3">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-large-title text-label-primary">Messages</h1>
            <p className="text-subhead text-label-secondary mt-0.5">
              {familyMembers.length} family members
            </p>
          </div>
          <Glyph color="messages" size="md">
            <MessageSquare className="w-4 h-4" />
          </Glyph>
        </div>
      </div>

      {/* Chat area */}
      <div className="card-apple mx-4 overflow-hidden">
        {/* Messages thread */}
        <div
          ref={threadRef}
          onScroll={handleScroll}
          className="h-[calc(100vh-18rem)] overflow-y-auto"
          role="region"
          aria-label="Messages thread"
          tabIndex={0}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-subhead text-label-secondary">Loading…</div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full px-4">
              <EmptyState
                icon={MessageSquare}
                glyphColor="messages"
                illustration={ILLUSTRATIONS.messagesEmpty}
                title="No messages yet"
                description="Start the conversation with your family."
              />
            </div>
          ) : (
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
                    {loadingEarlier ? 'Loading earlier messages…' : 'Load earlier messages'}
                  </button>
                  {earlierError && (
                    <p role="alert" className="text-footnote text-[var(--danger-text)] text-center">
                      {earlierError}
                    </p>
                  )}
                </div>
              )}
              {messages.map((message) => {
                const isCurrentUser = message.sender_id === currentUserId
                const sender = message.sender
                return (
                  <div key={message.id} className="px-4 py-2">
                    {/* Avatar + name header */}
                    <div className="flex items-center gap-2 mb-1">
                      <Avatar name={sender?.name || '?'} src={sender?.avatar_url} size="xs" />
                      <span className="text-footnote font-semibold text-label-primary">
                        {isCurrentUser ? 'You' : sender?.name}
                      </span>
                      <span className="text-caption-1 text-label-tertiary">
                        {formatDate(message.created_at)}
                      </span>
                    </div>
                    {/* Message bubble */}
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
          )}
        </div>

        {/* Bottom anchored input */}
        <div className="border-t border-[var(--surface-separator)] px-4 py-3 bg-[var(--surface-base)]">
          <form onSubmit={handleSendMessage} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAttach(!showAttach)}
              className={cn(
                'w-11 h-11 rounded-full flex items-center justify-center transition-colors',
                showAttach
                  ? 'bg-tint-messages text-white'
                  : 'bg-surface-fill text-label-secondary hover:bg-surface-fill-secondary'
              )}
              aria-label="Attach"
            >
              <Plus className="w-4 h-4" />
            </button>
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Message"
              className="input-apple flex-1"
              disabled={sending}
              aria-label="Message text"
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
              aria-label="Send"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>

          {sendError && (
            <p id="message-send-error" role="alert" className="pt-2 text-footnote text-[var(--danger-text)]">
              {sendError}
            </p>
          )}

          {/* Live region for screen readers — announces send events */}
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {sending ? 'Sending message…' : ''}
          </div>
        </div>
      </div>
    </div>
  )
}
