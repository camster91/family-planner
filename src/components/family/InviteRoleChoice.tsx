'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export type InviteRole = 'parent' | 'teen' | 'child'

/** Parent first: the order the inviter reads, never a pre-picked default. */
export const INVITE_ROLE_ORDER: readonly InviteRole[] = ['parent', 'teen', 'child']

/**
 * The inviter chooses the invited person's role explicitly (Parent, Teen or
 * Child). Nothing is selected until they pick, so an invite can never go out
 * as Child by default; the caller keeps its submit disabled while `value` is
 * null. Native radios: arrow keys, labels and required state for free.
 */
export function InviteRoleChoice({
  name,
  legend,
  labels,
  value,
  onChange,
  disabled,
}: {
  /** Radio group name, unique on the page. */
  name: string
  legend: string
  labels: Record<InviteRole, string>
  value: InviteRole | null
  onChange: (role: InviteRole) => void
  disabled?: boolean
}) {
  return (
    <fieldset disabled={disabled} data-testid={`${name}-choice`} className="min-w-0">
      <legend className="label-apple">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {INVITE_ROLE_ORDER.map((role) => (
          <label
            key={role}
            className={cn(
              'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2 text-[15px] text-label-primary',
              'focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-[var(--accent-text)]',
              value === role
                ? 'border-[var(--accent-text)] bg-[var(--accent-tint)] font-semibold'
                : 'border-[var(--surface-separator)]',
            )}
          >
            <input
              type="radio"
              name={name}
              value={role}
              required
              checked={value === role}
              onChange={() => onChange(role)}
              className="h-5 w-5 shrink-0 accent-[var(--accent)]"
            />
            <span className="min-w-0 break-words">{labels[role]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
