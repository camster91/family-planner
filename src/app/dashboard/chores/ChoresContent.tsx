'use client'

import * as React from 'react'
import { Plus, CheckSquare, Flame } from 'lucide-react'
import Link from 'next/link'
import { CheckboxRow } from '@/components/ui/checkbox-row'
import { ListRow } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { LargeHeader } from '@/components/ui/large-header'
import { Glyph } from '@/components/ui/glyph'
import { useToast } from '@/components/ui/toast'
import { LongPressRow } from '@/components/ui/long-press-row'
import { cn } from '@/lib/utils'
import type { Chore } from '@/types'

type FilterMode = 'today' | 'week' | 'all'

interface ChoresContentProps {
  chores: (Chore & { assignee: { name: string } | null; creator: { name: string } | null; streak?: number })[]
  familyMembers: { id: string; name: string; role: string; age?: number }[]
  currentUserId: string
  userRole: string
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatRelativeDate(dateStr: string): string {
  const d = new Date(dateStr)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr)
  const today = new Date()
  return d.toDateString() === today.toDateString()
}

function isThisWeek(dateStr: string): boolean {
  const d = new Date(dateStr)
  const today = new Date()
  const endOfWeek = new Date(today)
  endOfWeek.setDate(today.getDate() + 7)
  return d >= today && d <= endOfWeek
}

// Reassign modal
function ReassignModal({
  familyMembers,
  onConfirm,
  onCancel,
}: {
  familyMembers: { id: string; name: string; role: string }[]
  onConfirm: (assigneeId: string) => void
  onCancel: () => void
}) {
  const [selectedId, setSelectedId] = React.useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative z-10 w-72 rounded-2xl overflow-hidden bg-[var(--surface-elevated)] shadow-xl">
        <div className="px-4 py-4 border-b border-[var(--surface-border)]">
          <p className="text-subhead font-semibold text-label-primary">Reassign chore</p>
        </div>
        <div className="p-4 space-y-2 max-h-60 overflow-y-auto">
          {familyMembers.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelectedId(m.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left',
                'transition-colors duration-150',
                selectedId === m.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'active:bg-[var(--surface-fill-secondary)] text-label-primary'
              )}
            >
              <div className="w-7 h-7 rounded-full bg-[var(--surface-fill-secondary)] flex items-center justify-center text-label-secondary text-footnote font-medium">
                {m.name[0].toUpperCase()}
              </div>
              <span className="text-body">{m.name}</span>
              <span className="ml-auto text-footnote text-label-tertiary capitalize">{m.role}</span>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-[var(--surface-border)] flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-body font-medium text-label-secondary active:bg-[var(--surface-fill-secondary)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => selectedId && onConfirm(selectedId)}
            disabled={!selectedId}
            className="flex-1 py-2.5 rounded-xl text-body font-medium bg-[var(--accent)] text-white disabled:opacity-40 active:scale-95 transition-all"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ChoresContent({
  chores,
  familyMembers,
  currentUserId,
  userRole,
}: ChoresContentProps) {
  const [filter, setFilter] = React.useState<FilterMode>('today')
  const [localChores, setLocalChores] = React.useState(chores)
  const [doneCollapsed, setDoneCollapsed] = React.useState(true)
  const { addToast } = useToast()
  const [reassignTarget, setReassignTarget] = React.useState<string | null>(null)

  React.useEffect(() => {
    setLocalChores(chores)
  }, [chores])

  const handleCompleteChore = React.useCallback(async (choreId: string) => {
    try {
      const response = await fetch('/api/chores/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choreId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to complete chore')

      setLocalChores(prev => prev.map(c =>
        c.id === choreId ? { ...c, status: 'completed' as const, completed_at: new Date().toISOString() } : c
      ))
      addToast({ type: 'success', title: 'Chore completed!', message: 'Great work.' })
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Failed to complete chore',
        message: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }, [addToast])

  const handleSnoozeChore = React.useCallback(async (choreId: string) => {
    const newDueDate = new Date(Date.now() + 3600000).toISOString()
    try {
      const response = await fetch('/api/chores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choreId, due_date: newDueDate }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to snooze chore')

      setLocalChores(prev => prev.map(c =>
        c.id === choreId ? { ...c, due_date: newDueDate } : c
      ))
      addToast({ type: 'success', title: 'Snoozed 1h', message: 'New due time updated.' })
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Failed to snooze',
        message: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }, [addToast])

  const handleReassignChore = React.useCallback(async (choreId: string, assigneeId: string) => {
    try {
      const response = await fetch('/api/chores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choreId, assigned_to: assigneeId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to reassign chore')

      setLocalChores(prev => prev.map(c =>
        c.id === choreId
          ? { ...c, assignee: familyMembers.find(m => m.id === assigneeId) ?? c.assignee }
          : c
      ))
      addToast({ type: 'success', title: 'Chore reassigned', message: 'Assignment updated.' })
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Failed to reassign',
        message: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }, [addToast, familyMembers])

  const handleDeleteChore = React.useCallback(async (choreId: string) => {
    if (!confirm('Delete this chore?')) return
    try {
      const response = await fetch('/api/chores', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choreId }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete chore')
      }
      setLocalChores(prev => prev.filter(c => c.id !== choreId))
      addToast({ type: 'success', title: 'Chore deleted' })
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Failed to delete',
        message: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }, [addToast])

  const filtered = localChores.filter(c => {
    if (filter === 'today') return isToday(c.due_date)
    if (filter === 'week') return isThisWeek(c.due_date)
    return true
  })

  const todayChores = filtered.filter(c => c.status === 'pending' || c.status === 'in_progress')
  const doneChores = filtered.filter(c => c.status === 'completed' || c.status === 'verified')

  const SegmentedControl = ({ value, onChange }: { value: FilterMode; onChange: (v: FilterMode) => void }) => (
    <div className="flex bg-[var(--surface-fill)] rounded-lg p-1 gap-1">
      {(['today', 'week', 'all'] as FilterMode[]).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            'flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all duration-200',
            value === opt
              ? 'bg-[var(--surface-elevated)] text-label-primary shadow-sm'
              : 'text-label-secondary hover:text-label-primary'
          )}
        >
          {opt.charAt(0).toUpperCase() + opt.slice(1)}
        </button>
      ))}
    </div>
  )

  return (
    <div className="pb-20">
      <LargeHeader
        title="Chores"
        subtitle={`${todayChores.length} pending`}
        trailing={
          <Link href="/dashboard/chores/create" className="btn-filled shrink-0" aria-label="Add chore">
            <Plus className="w-4 h-4" />
          </Link>
        }
        className="px-4"
      />

      <div className="px-4 mb-4">
        <SegmentedControl value={filter} onChange={setFilter} />
      </div>

      <div className="space-y-6 px-4">
        {todayChores.length > 0 ? (
          <section>
            <p className="section-header">Today</p>
            <div className="list-inset stagger">
              {todayChores.map((chore, i) => (
                <LongPressRow
                  key={chore.id}
                  actions={[
                    {
                      label: 'Snooze 1h',
                      onClick: () => handleSnoozeChore(chore.id),
                    },
                    {
                      label: 'Reassign',
                      onClick: () => setReassignTarget(chore.id),
                    },
                    {
                      label: 'Mark complete',
                      onClick: () => handleCompleteChore(chore.id),
                    },
                    {
                      label: 'Delete',
                      onClick: () => handleDeleteChore(chore.id),
                      destructive: true,
                    },
                  ]}
                >
                  <CheckboxRow
                    checked={false}
                    onChange={() => handleCompleteChore(chore.id)}
                    title={chore.title}
                    subtitle={
                      chore.assignee
                        ? `${chore.assignee.name} · ${formatRelativeDate(chore.due_date)}`
                        : formatRelativeDate(chore.due_date)
                    }
                    glyph={
                      <Glyph color="chore" size="sm">
                        <CheckSquare className="w-4 h-4 text-white" />
                      </Glyph>
                    }
                    meta={
                      chore.points > 0 || (chore.streak && chore.streak >= 3)
                        ? (
                          <span className="flex items-center gap-1">
                            {chore.points > 0 && <span className="text-footnote text-label-tertiary">+{chore.points}</span>}
                            {chore.streak && chore.streak >= 3 && (
                              <span className="flex items-center text-orange-500" title={`${chore.streak} day streak`}>
                                <Flame className="w-3 h-3 fill-orange-500" />
                                <span className="text-footnote">{chore.streak}</span>
                              </span>
                            )}
                          </span>
                        )
                        : undefined
                    }
                    className={cn(i === todayChores.length - 1 && 'border-b-0')}
                  />
                </LongPressRow>
              ))}
            </div>
          </section>
        ) : (
          <EmptyState
            icon={CheckSquare}
            glyphColor="chore"
            title="All clear!"
            description={filter === 'today' ? 'No chores due today.' : 'No chores in this range.'}
          />
        )}

        {doneChores.length > 0 && (
          <section>
            <button
              type="button"
              onClick={() => setDoneCollapsed(!doneCollapsed)}
              className="section-header w-full text-left flex items-center justify-between pr-4"
            >
              <span>Done</span>
              <span className="text-label-tertiary text-xs">{doneChores.length}</span>
            </button>
            {!doneCollapsed && (
              <div className="list-inset">
                {doneChores.map((chore, i) => (
                  <ListRow
                    key={chore.id}
                    icon={CheckSquare}
                    glyphColor="chore"
                    title={chore.title}
                    subtitle={formatDate(chore.due_date)}
                    showChevron={false}
                    trailing={<span className="text-footnote text-label-tertiary">+{chore.points}</span>}
                    className={cn(i === doneChores.length - 1 && 'border-b-0')}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Parent-only: Pending photo verification queue */}
        {userRole === 'parent' && (() => {
          const pendingVerification = localChores.filter(c =>
            c.status === 'completed' && !c.photo_verified
          )
          if (pendingVerification.length === 0) return null
          return (
            <section>
              <p className="section-header">Pending Verification</p>
              <div className="list-inset">
                {pendingVerification.map((chore, i) => (
                  <div
                    key={chore.id}
                    className={cn(
                      'px-4 py-3 flex items-center gap-3',
                      'border-b border-[var(--surface-separator)] last:border-b-0'
                    )}
                  >
                    {chore.photo_url && (
                      <div className="w-10 h-10 rounded-[var(--radius-md)] overflow-hidden bg-[var(--surface-fill)] shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={chore.photo_url} alt="" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-body text-label-primary truncate">{chore.title}</p>
                      <p className="text-footnote text-label-secondary">Awaiting verification</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/chores', {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                choreId: chore.id,
                                photo_verified: true,
                                verified_at: new Date().toISOString(),
                                status: 'verified',
                              }),
                            })
                            if (!res.ok) throw new Error('Verify failed')
                            setLocalChores(prev => prev.map(c =>
                              c.id === chore.id
                                ? { ...c, photo_verified: true, verified_at: new Date().toISOString(), status: 'verified' as const }
                                : c
                            ))
                            addToast({ type: 'success', title: 'Chore verified!' })
                          } catch {
                            addToast({ type: 'error', title: 'Failed to verify' })
                          }
                        }}
                        className="btn-filled text-sm py-1.5 px-3"
                      >
                        Verify
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const notes = prompt('Rejection reason (sent to child):')
                          if (notes === null) return
                          try {
                            const res = await fetch('/api/chores', {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                choreId: chore.id,
                                photo_verified: false,
                                verified_notes: notes,
                                status: 'in_progress',
                              }),
                            })
                            if (!res.ok) throw new Error('Reject failed')
                            setLocalChores(prev => prev.map(c =>
                              c.id === chore.id
                                ? { ...c, photo_verified: false, verified_notes: notes, status: 'in_progress' as const }
                                : c
                            ))
                            addToast({ type: 'success', title: 'Chore sent back' })
                          } catch {
                            addToast({ type: 'error', title: 'Failed to reject' })
                          }
                        }}
                        className="btn-destructive text-sm py-1.5 px-3"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
        })()}
      </div>

      {/* Reassign modal */}
      {reassignTarget && (
        <ReassignModal
          familyMembers={familyMembers}
          onConfirm={(assigneeId) => {
            handleReassignChore(reassignTarget, assigneeId)
            setReassignTarget(null)
          }}
          onCancel={() => setReassignTarget(null)}
        />
      )}
    </div>
  )
}