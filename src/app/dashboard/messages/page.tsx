'use client'

import { useState, useEffect, useRef } from 'react'
import { Send, Plus, MessageSquare } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Glyph } from '@/components/ui/glyph'
import { InsetList } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { cn, formatDate } from '@/lib/utils'

export default function MessagesPage() {
  const [messages, setMessages] = useState<any[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [familyMembers, setFamilyMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [showAttach, setShowAttach] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 5000)
    return () => clearInterval(interval)
  }, [])

  const loadData = async () => {
    try {
      const res = await fetch('/api/messages')
      const data = await res.json()
      if (res.ok) {
        if (data.messages) setMessages(data.messages)
        if (data.members) setFamilyMembers(data.members)
        if (data.userId) setCurrentUserId(data.userId)
      }
    } catch (err) {
      console.error('Error loading data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || sending) return

    setSending(true)
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newMessage.trim(), type: 'text' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send message')
      if (data.message) setMessages(prev => [...prev, data.message])
      setNewMessage('')
    } catch (err) {
      console.error('Error sending message:', err)
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
        <div className="h-[calc(100vh-18rem)] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-subhead text-label-secondary">Loading…</div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full px-4">
              <EmptyState
                icon={MessageSquare}
                glyphColor="messages"
                title="No messages yet"
                description="Start the conversation with your family."
              />
            </div>
          ) : (
            <div className="py-3">
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
              <div ref={messagesEndRef} />
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

          {/* Live region for screen readers — announces send events */}
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {sending ? 'Sending message…' : ''}
          </div>
        </div>
      </div>
    </div>
  )
}