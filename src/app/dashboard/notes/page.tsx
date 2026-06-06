'use client'

import * as React from 'react'
import { Plus, StickyNote as NoteIcon } from 'lucide-react'
import { FeatureGate } from '@/components/ui/feature-gate'
import { cn } from '@/lib/utils'

interface Note {
  id: string
  title: string
  body: string
  color: 'yellow' | 'pink' | 'blue'
  created_at: string
}

const DEMO_NOTES: Note[] = [
  {
    id: '1',
    title: 'Grocery List',
    body: 'Milk, eggs, bread, cheese, apples',
    color: 'yellow',
    created_at: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Pick up kids',
    body: 'School at 3pm, soccer at 5pm',
    color: 'pink',
    created_at: new Date().toISOString(),
  },
  {
    id: '3',
    title: 'Weekend Plans',
    body: 'Picnic on Saturday, movie night on Sunday',
    color: 'blue',
    created_at: new Date().toISOString(),
  },
]

const noteColors = {
  yellow: {
    bg: 'bg-[var(--tint-meals)]/20',
    border: 'border-[var(--tint-meals)]/30',
    header: 'bg-[var(--tint-meals)]',
  },
  pink: {
    bg: 'bg-[var(--tint-messages)]/20',
    border: 'border-[var(--tint-messages)]/30',
    header: 'bg-[var(--tint-messages)]',
  },
  blue: {
    bg: 'bg-[var(--tint-budget)]/20',
    border: 'border-[var(--tint-budget)]/30',
    header: 'bg-[var(--tint-budget)]',
  },
}

export default function NotesPage() {
  return (
    <FeatureGate featureKey="notes">
      <NotesPageInner />
    </FeatureGate>
  )
}

function NotesPageInner() {
  const [notes] = React.useState<Note[]>(DEMO_NOTES)

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-large-title font-display">Notes</h1>
          <p className="text-subhead text-label-secondary mt-0.5">Pinned to the fridge</p>
        </div>
        <button
          type="button"
          className="btn-tinted"
          aria-label="Add note"
        >
          <Plus className="w-4 h-4" />
          <span>Add Note</span>
        </button>
      </div>

      {/* Notes grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
        {notes.map((note) => {
          const colors = noteColors[note.color]
          return (
            <div
              key={note.id}
              className={cn(
                'card-apple border-[1.5px] overflow-hidden',
                'flex flex-col h-[160px]',
                colors.bg,
                colors.border
              )}
            >
              {/* Colored header strip */}
              <div className={cn('h-1.5 w-full', colors.header)} />

              {/* Content */}
              <div className="flex-1 p-4 flex flex-col">
                <div className="flex items-start gap-2 mb-2">
                  <NoteIcon className="w-4 h-4 text-label-tertiary mt-0.5 shrink-0" />
                  <h3 className="text-headline text-label-primary line-clamp-1">
                    {note.title}
                  </h3>
                </div>
                <p className="text-subhead text-label-secondary line-clamp-3 flex-1">
                  {note.body}
                </p>
              </div>
            </div>
          )
        })}

        {/* Add note card */}
        <button
          type="button"
          className={cn(
            'card-apple border-2 border-dashed border-[var(--surface-separator)]',
            'flex flex-col items-center justify-center h-[160px]',
            'text-label-tertiary hover:border-[var(--accent)] hover:text-[var(--accent)]',
            'transition-colors duration-[var(--duration-fast)]'
          )}
        >
          <Plus className="w-8 h-8 mb-2" />
          <span className="text-subhead">New Note</span>
        </button>
      </div>
    </div>
  )
}