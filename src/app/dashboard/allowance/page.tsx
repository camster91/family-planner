'use client'

import * as React from 'react'
import { Plus, Wallet, Check, Trash2 } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { FeatureGate } from '@/components/ui/feature-gate'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { ListRow, InsetList, SectionHeader } from '@/components/ui/list-row'
import { useToast } from '@/components/ui/toast'
import { OFFLINE_MESSAGE, responseErrorMessage } from '@/lib/fetch-error'

interface AllowanceItem {
  id: string
  amount: number
  reason?: string | null
  status: 'pending' | 'paid' | 'cancelled'
  scheduled_for?: string | null
  paid_at?: string | null
  from_user_id: string
  to_user_id: string
  from_name?: string
  to_name?: string
  to_avatar?: string | null
  created_at: string
}

export default function AllowancePage() {
  return (
    <FeatureGate featureKey="allowance">
      <AllowancePageInner />
    </FeatureGate>
  )
}

function AllowancePageInner() {
  const [items, setItems] = React.useState<AllowanceItem[]>([])
  const [members, setMembers] = React.useState<{ id: string; name: string; avatar_url?: string | null }[]>([])
  const [loading, setLoading] = React.useState(true)
  const [adding, setAdding] = React.useState(false)
  const [draft, setDraft] = React.useState({ to_user_id: '', amount: '', reason: '' })
  const formId = React.useId()
  const [saving, setSaving] = React.useState(false)
  // D5 (#102): teens and children see only their own allowance, read-only.
  // The API filters the rows; the page hides every control that would write.
  // Null until /api/auth/me answers, so the controls never flash for a kid.
  const [role, setRole] = React.useState<string | null>(null)
  const isParent = role === 'parent'

  // KidHome pattern: a refused or failed request says so in a toast instead
  // of doing nothing (or leaving an unhandled rejection when offline).
  const { addToast } = useToast()
  const failed = React.useCallback(
    async (title: string, res?: Response) => {
      addToast({ type: 'error', title, message: res ? await responseErrorMessage(res) : OFFLINE_MESSAGE })
    },
    [addToast]
  )

  React.useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setRole(d?.user?.role ?? null))
      .catch(() => {})
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [a, f] = await Promise.all([
        fetch('/api/allowance', { cache: 'no-store' }).then((r) => {
          if (!r.ok) throw new Error('allowance load failed')
          return r.json()
        }),
        fetch('/api/family/members', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ members: [] })),
      ])
      setItems(a.items || [])
      setMembers(f.members || [])
    } catch {
      await failed("Couldn't load allowance")
    } finally {
      setLoading(false)
    }
  }, [failed])

  React.useEffect(() => { load() }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseFloat(draft.amount)
    if (!draft.to_user_id || isNaN(amount) || amount <= 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/allowance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_user_id: draft.to_user_id, amount, reason: draft.reason.trim() || null }),
      })
      if (res.ok) {
        setDraft({ to_user_id: '', amount: '', reason: '' })
        setAdding(false)
        load()
      } else {
        await failed("Couldn't add the allowance", res)
      }
    } catch {
      await failed("Couldn't add the allowance")
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(id: string, status: 'paid' | 'cancelled', failure: string) {
    try {
      const res = await fetch(`/api/allowance/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        await failed(failure, res)
        return
      }
    } catch {
      await failed(failure)
      return
    }
    load()
  }

  async function markPaid(id: string) {
    await setStatus(id, 'paid', "Couldn't mark it paid")
  }

  async function cancel(id: string) {
    if (!confirm('Cancel this allowance?')) return
    await setStatus(id, 'cancelled', "Couldn't cancel the allowance")
  }

  const pending = items.filter((i) => i.status === 'pending')
  const paid = items.filter((i) => i.status === 'paid').slice(0, 10)

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <LargeHeader
        greeting="Family"
        title="Allowance"
        subtitle={
          role === null || isParent
            ? 'Track weekly allowance and money owed between members.'
            : 'Your allowance: what you have coming and what has been paid.'
        }
        trailing={
          isParent && !adding ? (
            <button type="button" onClick={() => setAdding(true)} className="btn-tinted">
              <Plus className="w-4 h-4" />
              <span>Add</span>
            </button>
          ) : null
        }
      />

      {isParent && adding && (
        <form onSubmit={add} className="card-apple p-4 space-y-3 animate-spring-up">
          <div className="flex items-center gap-2">
            <div className="glyph bg-tint-budget">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <span className="text-headline">New allowance</span>
          </div>
          <div>
            <label htmlFor={`${formId}-for`} className="label-apple">For</label>
            <select
              id={`${formId}-for`}
              value={draft.to_user_id}
              onChange={(e) => setDraft({ ...draft, to_user_id: e.target.value })}
              className="input-apple"
            >
              <option value="">Choose a family member</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${formId}-amount`} className="label-apple">Amount</label>
            <input
              id={`${formId}-amount`}
              type="number"
              step="0.01"
              min="0"
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              placeholder="10.00"
              className="input-apple"
            />
          </div>
          <div>
            <label htmlFor={`${formId}-reason`} className="label-apple">Reason</label>
            <input
              id={`${formId}-reason`}
              type="text"
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              placeholder="Weekly allowance"
              className="input-apple"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setAdding(false); setDraft({ to_user_id: '', amount: '', reason: '' }) }}
              className="btn-plain"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-filled">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
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
      ) : items.length === 0 ? (
        <EmptyState
          icon={Wallet}
          glyphColor="budget"
          title="No allowance yet"
          description={
            role === null || isParent
              ? 'Track weekly allowance and money owed between members. Kids can see what they have coming.'
              : 'Nothing yet. When a parent adds allowance for you, it shows up here.'
          }
        />
      ) : (
        <>
          {pending.length > 0 && (
            <section>
              <SectionHeader>Pending</SectionHeader>
              <InsetList>
                {pending.map((it, i) => (
                  <AllowanceRow
                    key={it.id}
                    item={it}
                    canManage={isParent}
                    onMarkPaid={markPaid}
                    onCancel={cancel}
                    last={i === pending.length - 1}
                  />
                ))}
              </InsetList>
            </section>
          )}
          {paid.length > 0 && (
            <section>
              <SectionHeader>Recently paid</SectionHeader>
              <InsetList>
                {paid.map((it, i) => (
                  <AllowanceRow key={it.id} item={it} canManage={isParent} onMarkPaid={markPaid} onCancel={cancel} last={i === paid.length - 1} />
                ))}
              </InsetList>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function AllowanceRow({
  item,
  canManage,
  onMarkPaid,
  onCancel,
  last,
}: {
  item: AllowanceItem
  canManage: boolean
  onMarkPaid: (id: string) => void
  onCancel: (id: string) => void
  last: boolean
}) {
  return (
    <div className={last ? '' : 'border-b border-[var(--surface-separator)]'}>
      <div className="row-apple">
        <Avatar name={item.to_name || '?'} src={item.to_avatar} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="text-body text-label-primary">
            ${item.amount.toFixed(2)} → {item.to_name}
          </div>
          <div className="text-footnote text-label-secondary truncate">
            {item.reason || (item.status === 'paid' && item.paid_at
              ? `Paid ${new Date(item.paid_at).toLocaleDateString()}`
              : 'No reason')}
          </div>
        </div>
        {item.status === 'pending' && !canManage && (
          <span className="text-caption-1 font-semibold text-label-secondary uppercase tracking-wide">Pending</span>
        )}
        {item.status === 'pending' && canManage && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onMarkPaid(item.id)}
              className="inline-flex h-11 w-11 items-center justify-center text-[var(--success)] active:opacity-60"
              aria-label="Mark paid"
            >
              <Check className="w-5 h-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onCancel(item.id)}
              className="inline-flex h-11 w-11 items-center justify-center text-label-tertiary active:text-[var(--danger-text)]"
              aria-label="Cancel"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
        {item.status === 'paid' && (
          <span className="text-caption-1 font-semibold text-[var(--success)] uppercase tracking-wide">Paid</span>
        )}
        {item.status === 'cancelled' && (
          <span className="text-caption-1 font-semibold text-label-tertiary uppercase tracking-wide">Cancelled</span>
        )}
      </div>
    </div>
  )
}
