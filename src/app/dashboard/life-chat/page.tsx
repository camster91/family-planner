'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowUp, ArrowUpRight, ShieldCheck, Sparkles } from 'lucide-react'
import { findMiniAppByQuery } from '@/lib/mini-apps'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  href?: string
  actionLabel?: string
}

const STARTERS = [
  'Open chores',
  'Where do I plan meals?',
  'Show me the family calendar',
  'Where will habits live?',
]

export default function LifeChatPage() {
  const [input, setInput] = React.useState('')
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: 1,
      role: 'assistant',
      text: 'Life Chat is starting as a read-only guide to your mini apps. I can help you find the right place now; family-data answers and confirmed actions will be added in later migration waves.',
    },
  ])
  const nextId = React.useRef(2)

  const send = React.useCallback((raw: string) => {
    const text = raw.trim()
    if (!text) return

    const userMessage: ChatMessage = {
      id: nextId.current++,
      role: 'user',
      text,
    }

    const app = findMiniAppByQuery(text)
    let assistantMessage: ChatMessage

    if (app?.href) {
      assistantMessage = {
        id: nextId.current++,
        role: 'assistant',
        text: `${app.title} is available in the Life Hub. I can take you there.`,
        href: app.href,
        actionLabel: `Open ${app.title}`,
      }
    } else if (app?.status === 'planned') {
      assistantMessage = {
        id: nextId.current++,
        role: 'assistant',
        text: `${app.title} is part of the consolidation plan, but it has not been migrated into Family Planner yet. The source data will be preserved before that module is enabled.`,
      }
    } else {
      assistantMessage = {
        id: nextId.current++,
        role: 'assistant',
        text: 'I cannot answer from family data yet. In this foundation version I only resolve mini-app navigation. The next Life Chat phase will add authorized read tools for Today, chores, habits, meals, lists, calendar, budget and projects.',
      }
    }

    setMessages((current) => [...current, userMessage, assistantMessage])
    setInput('')
  }, [])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    send(input)
  }

  return (
    <div className="max-w-3xl mx-auto h-[calc(100dvh-9rem)] min-h-[560px] flex flex-col">
      <header className="pb-4 border-b border-[var(--surface-separator)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--accent-tint)] flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-[var(--accent)]" />
          </div>
          <div>
            <h1 className="text-title-1 font-display">Life Chat</h1>
            <p className="text-caption-1 text-label-secondary">Read-only foundation</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto py-5 space-y-4" aria-live="polite">
        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={
                message.role === 'user'
                  ? 'max-w-[85%] rounded-2xl rounded-br-md bg-accent-fill text-white px-4 py-3'
                  : 'max-w-[90%] card-apple px-4 py-3'
              }
            >
              <p className={message.role === 'user' ? 'text-body text-white' : 'text-body text-label-primary'}>
                {message.text}
              </p>
              {message.href && message.actionLabel && (
                <Link
                  href={message.href}
                  className="inline-flex items-center gap-1.5 mt-3 text-subhead font-semibold text-[var(--accent)] rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  {message.actionLabel}
                  <ArrowUpRight className="w-4 h-4" />
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3 pt-3 border-t border-[var(--surface-separator)]">
        {messages.length <= 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Suggested prompts">
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => send(starter)}
                className="shrink-0 px-3 py-2 rounded-full bg-[var(--surface-fill)] text-subhead text-label-secondary active:bg-[var(--surface-fill-secondary)]"
              >
                {starter}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="card-apple p-2 flex items-end gap-2">
          <label htmlFor="life-chat-input" className="sr-only">Message Life Chat</label>
          <textarea
            id="life-chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send(input)
              }
            }}
            rows={1}
            placeholder="Ask about your life apps…"
            className="flex-1 resize-none bg-transparent px-2 py-2 text-body text-label-primary outline-none placeholder:text-label-tertiary max-h-32"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-9 h-9 rounded-full bg-accent-fill text-white flex items-center justify-center disabled:opacity-40"
            aria-label="Send message"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </form>

        <div className="flex items-start gap-2 px-1 text-caption-1 text-label-tertiary">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            Life Chat cannot change family data in this version. Future write actions will show an exact preview and require confirmation before execution.
          </p>
        </div>
      </div>
    </div>
  )
}
