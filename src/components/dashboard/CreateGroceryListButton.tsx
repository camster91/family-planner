'use client'

import * as React from 'react'
import { useCreateGroceryListText } from '@/i18n/create-grocery-list'
import { cn } from '@/lib/utils'

/**
 * "Create a grocery list" for a household that has none (older households;
 * new ones get "Groceries" when they are created). Uses the existing
 * find-or-create route, so a double tap or a second device never makes a
 * second list. Parent and teen only, like list creation; the caller decides.
 */
export function CreateGroceryListButton({
  onCreated,
  className,
}: {
  /** Re-read the page once the list exists. */
  onCreated: () => void
  className?: string
}) {
  const text = useCreateGroceryListText()
  const [busy, setBusy] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const sending = React.useRef(false)

  const create = async () => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch('/api/lists/default-grocery', { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      onCreated()
    } catch {
      setFailed(true)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy}
        data-testid="create-grocery-list"
        className={cn(className, 'disabled:opacity-60')}
      >
        {text(busy ? 'creatingGroceryList' : 'createGroceryList')}
      </button>
      {failed && (
        <p role="alert" className="basis-full text-footnote text-[var(--danger-text)]">
          {text('createGroceryListFailed')}
        </p>
      )}
    </>
  )
}
