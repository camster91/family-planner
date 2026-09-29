'use client'

/**
 * Board tiles that act directly (#274): tap a chore to mark it done, tap a
 * grocery item to tick it off, with an Undo toast. The board itself only
 * knows this interface; the two surfaces implement it:
 *
 * - a signed-in person (`usePersonBoardActions`, ./use-person-board-actions.ts):
 *   the existing POST /api/chores/complete and /api/chores/uncomplete, and the
 *   person's #162 offline queue for ticks;
 * - a paired tablet (src/components/device/use-device-board-actions.ts): the
 *   §9.2 device routes, "Who's this?" attribution and the device queue.
 *
 * `useBoardTiles` layers optimistic state over the server's snapshot, shows
 * the toasts and rolls a failed action back.
 */
import * as React from 'react'
import type { BoardChore } from '@/app/dashboard/today/today-board-data'
import type { ShoppingSnapshot, ShoppingSnapshotItem } from '@/lib/shopping-snapshot'
import { UNDO_TOAST_MS, useMaybeToast } from '@/components/ui/toast'

export type ActionResult = { ok: true } | { ok: false; message: string }

export interface BoardActions {
  /** May this viewer tick this chore on the board (own chore, or any chore for a parent)? */
  canCompleteChore(chore: BoardChore): boolean
  /** Whether grocery rows are tappable at all. */
  canTickGroceries: boolean
  completeChore(chore: BoardChore): Promise<ActionResult>
  /** Reverses a completion this board just made; absent when Undo is not offered. */
  undoChore?: (chore: BoardChore) => Promise<ActionResult>
  /** Queues the explicit desired state for a grocery item. Resolves when queued. */
  setGroceryChecked(item: ShoppingSnapshotItem, checked: boolean): Promise<ActionResult>
  /**
   * Hears a queued grocery write that finally failed (conflict, refused), so
   * the board can put the item back. Returns an unsubscribe function.
   */
  onGroceryFailed?: (listener: (itemId: string, checked: boolean) => void) => () => void
  /** Extra line under a chore's "done" toast (e.g. "A parent will check it."). */
  choreDoneNote?: (chore: BoardChore) => string | undefined
  /** Who the toast says did it on a shared tablet ("by Avery"). */
  actorLabel?: () => string | null
  /**
   * Runs before a tap acts (the tablet's "Who's this?"). Resolving false
   * cancels the tap with nothing changed.
   */
  prepare?: () => Promise<boolean>
  /** Called after a change the server confirmed, to re-read the board. */
  afterChange?: () => void
}

export interface BoardTiles {
  /** Chores with optimistic statuses applied. */
  chores: BoardChore[]
  /** Groceries with optimistic ticks applied. */
  shopping: ShoppingSnapshot | null
  tickChore: ((chore: BoardChore) => void) | null
  canTickChore: (chore: BoardChore) => boolean
  tickGrocery: ((item: ShoppingSnapshotItem) => void) | null
}

/** Curly-quoted title for a toast. */
function quoted(title: string): string {
  return `“${title}”`
}

export function useBoardTiles(
  chores: BoardChore[],
  shopping: ShoppingSnapshot | null,
  actions: BoardActions | undefined
): BoardTiles {
  const { addToast } = useMaybeToast()
  // Undo over confirm (#269): the same toast as useUndoToast.
  const showUndo = (opts: { title: string; message?: string; onUndo: () => void }) =>
    addToast({
      type: 'undo',
      title: opts.title,
      message: opts.message,
      duration: UNDO_TOAST_MS,
      action: { label: 'Undo', onClick: opts.onUndo },
    })
  const [choreStatus, setChoreStatus] = React.useState<Record<string, string>>({})
  // true: hidden (ticked here, not yet off the server's snapshot); false: shown again by Undo.
  const [groceryTicked, setGroceryTicked] = React.useState<Record<string, boolean>>({})
  const seen = React.useRef(new Map<string, ShoppingSnapshotItem>())
  const busy = React.useRef(new Set<string>())

  // A fresh server snapshot replaces the optimistic chore layer.
  React.useEffect(() => {
    setChoreStatus({})
  }, [chores])

  // Keep only the grocery overrides the server has not caught up with yet.
  React.useEffect(() => {
    const present = new Set((shopping?.items ?? []).map((i) => i.id))
    for (const item of shopping?.items ?? []) seen.current.set(item.id, item)
    setGroceryTicked((prev) => {
      const next: Record<string, boolean> = {}
      for (const [id, ticked] of Object.entries(prev)) {
        if (ticked && present.has(id)) next[id] = true
        if (!ticked && !present.has(id)) next[id] = false
      }
      return next
    })
  }, [shopping])

  // A queued tick the server finally refused: put the row back and say so.
  React.useEffect(() => {
    if (!actions?.onGroceryFailed) return
    return actions.onGroceryFailed((itemId, checked) => {
      setGroceryTicked((prev) => {
        const next = { ...prev }
        delete next[itemId]
        return next
      })
      const item = seen.current.get(itemId)
      addToast({
        type: 'error',
        title: item
          ? `Couldn't ${checked ? 'tick off' : 'put back'} ${quoted(item.content)}`
          : `Couldn't update the grocery list`,
        message: 'The list may have changed. The board shows it as it is now.',
      })
    })
  }, [actions, addToast])

  const effectiveChores = React.useMemo(
    () => chores.map((c) => (choreStatus[c.id] ? { ...c, status: choreStatus[c.id] } : c)),
    [chores, choreStatus]
  )

  const effectiveShopping = React.useMemo(() => {
    if (!shopping) return null
    const hidden = shopping.items.filter((i) => groceryTicked[i.id] === true).length
    const restored = Object.entries(groceryTicked)
      .filter(([id, ticked]) => ticked === false && !shopping.items.some((i) => i.id === id))
      .map(([id]) => seen.current.get(id))
      .filter((i): i is ShoppingSnapshotItem => Boolean(i))
    return {
      items: [...shopping.items.filter((i) => groceryTicked[i.id] !== true), ...restored],
      total: Math.max(0, shopping.total - hidden + restored.length),
    }
  }, [shopping, groceryTicked])

  const setStatus = (id: string, status: string | null) =>
    setChoreStatus((prev) => {
      const next = { ...prev }
      if (status === null) delete next[id]
      else next[id] = status
      return next
    })

  const by = () => {
    const who = actions?.actorLabel?.()
    return who ? ` by ${who}` : ''
  }

  const undoChore = async (chore: BoardChore) => {
    if (!actions?.undoChore || busy.current.has(chore.id)) return
    busy.current.add(chore.id)
    setStatus(chore.id, 'pending')
    const result = await actions.undoChore(chore)
    busy.current.delete(chore.id)
    if (!result.ok) {
      setStatus(chore.id, 'completed')
      addToast({ type: 'error', title: `Couldn't undo ${quoted(chore.title)}`, message: result.message })
      return
    }
    actions.afterChange?.()
  }

  const tickChore = actions
    ? async (chore: BoardChore) => {
        if (busy.current.has(chore.id) || !actions.canCompleteChore(chore)) return
        busy.current.add(chore.id)
        if (actions.prepare && !(await actions.prepare())) {
          busy.current.delete(chore.id)
          return
        }
        setStatus(chore.id, 'completed')
        const result = await actions.completeChore(chore)
        busy.current.delete(chore.id)
        if (!result.ok) {
          setStatus(chore.id, null)
          addToast({ type: 'error', title: `Couldn't mark ${quoted(chore.title)} done`, message: result.message })
          return
        }
        const title = `${quoted(chore.title)} done${by()}`
        const note = actions.choreDoneNote?.(chore)
        if (actions.undoChore) {
          showUndo({ title, message: note, onUndo: () => void undoChore(chore) })
        } else {
          addToast({ type: 'success', title, message: note })
        }
        actions.afterChange?.()
      }
    : null

  const putBack = async (item: ShoppingSnapshotItem) => {
    if (!actions) return
    setGroceryTicked((prev) => ({ ...prev, [item.id]: false }))
    const result = await actions.setGroceryChecked(item, false)
    if (!result.ok) {
      setGroceryTicked((prev) => ({ ...prev, [item.id]: true }))
      addToast({ type: 'error', title: `Couldn't put back ${quoted(item.content)}`, message: result.message })
    }
  }

  const tickGrocery =
    actions && actions.canTickGroceries
      ? async (item: ShoppingSnapshotItem) => {
          if (actions.prepare && !(await actions.prepare())) return
          seen.current.set(item.id, item)
          setGroceryTicked((prev) => ({ ...prev, [item.id]: true }))
          const result = await actions.setGroceryChecked(item, true)
          if (!result.ok) {
            setGroceryTicked((prev) => {
              const next = { ...prev }
              delete next[item.id]
              return next
            })
            addToast({ type: 'error', title: `Couldn't tick off ${quoted(item.content)}`, message: result.message })
            return
          }
          showUndo({ title: `${quoted(item.content)} ticked off${by()}`, onUndo: () => void putBack(item) })
        }
      : null

  return {
    chores: effectiveChores,
    shopping: effectiveShopping,
    tickChore: tickChore ? (c) => void tickChore(c) : null,
    canTickChore: (c) => Boolean(actions?.canCompleteChore(c)),
    tickGrocery: tickGrocery ? (i) => void tickGrocery(i) : null,
  }
}
