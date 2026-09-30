'use client'

import * as React from 'react'
import { Dialog } from '@/components/ui/dialog'
import type { BoardMember } from '@/app/dashboard/today/today-board-data'
import type { BoardActions, ActionResult } from '@/components/fridge/board-actions'
import { DeviceApiError, type DeviceClient } from '@/lib/device-client'
import { newIdempotencyKey } from '@/lib/idempotency-key'
import { getDeviceQueue } from '@/lib/offline-queue-browser'
import { QueueError } from '@/lib/offline-queue'
import { MEMBER_COLOR_CSS, type MemberColorKey } from '@/lib/member-colors'
import { focusRing } from './styles'

/** A picked member is remembered this long after the last tap (memory only). */
export const ACTOR_IDLE_MS = 2 * 60 * 1000

export interface DeviceActorChoice {
  id: string
  name: string
}

function writeErrorText(error: unknown): string {
  if (error instanceof DeviceApiError) {
    if (error.code === 'NETWORK_ERROR') return "Couldn't reach Family Planner. Check the Wi-Fi and try again."
    if (error.status === 429) return 'Too many taps. Wait a minute, then try again.'
    if (error.status > 0 && error.status < 500 && error.message) return error.message
  }
  return 'Something went wrong. Try again.'
}

/**
 * Tile actions for a paired tablet (#274, SHARED_DEVICE.md §9.2):
 *
 * - before the first tap it asks "Who's this?" (names and colours from the
 *   board, §9.1) and remembers the answer in memory for two minutes after the
 *   last tap; the choice is unverified attribution (O-5) and never grants
 *   anything;
 * - a chore tap posts POST /api/device/chores/:id/complete with a fresh
 *   Idempotency-Key; Undo posts the tablet's own short-window
 *   POST /api/device/chores/:id/uncomplete;
 * - a grocery tap queues the explicit state in the device's #162 queue
 *   (PATCH /api/device/lists/items/:id), so it survives a dropped Wi-Fi.
 *
 * Returns no actions (a read-only board) unless the household turned tablet
 * writes on.
 */
export function useDeviceBoardActions({
  client,
  enabled,
  features,
  members,
  afterChange,
}: {
  client: DeviceClient | null
  enabled: boolean
  features: { chores: boolean; lists: boolean } | null
  members: BoardMember[]
  afterChange: () => void
}): {
  actions: BoardActions | undefined
  actor: DeviceActorChoice | null
  forgetActor: () => void
  picker: React.ReactNode
} {
  const [actor, setActor] = React.useState<DeviceActorChoice | null>(null)
  const actorRef = React.useRef<DeviceActorChoice | null>(null)
  const lastTapRef = React.useRef(0)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const resolver = React.useRef<((ok: boolean) => void) | null>(null)
  const afterRef = React.useRef(afterChange)
  afterRef.current = afterChange

  const chooseActor = React.useCallback((next: DeviceActorChoice | null) => {
    actorRef.current = next
    setActor(next)
  }, [])

  // Forget the member after two idle minutes, so the next person is asked again.
  React.useEffect(() => {
    if (!actor) return
    const id = window.setInterval(() => {
      if (Date.now() - lastTapRef.current >= ACTOR_IDLE_MS) chooseActor(null)
    }, 5000)
    return () => window.clearInterval(id)
  }, [actor, chooseActor])

  const settle = React.useCallback((ok: boolean) => {
    const resolve = resolver.current
    resolver.current = null
    setPickerOpen(false)
    resolve?.(ok)
  }, [])

  const choresOn = Boolean(enabled && features?.chores)
  const listsOn = Boolean(enabled && features?.lists)

  const actions = React.useMemo<BoardActions | undefined>(() => {
    if (!client || (!choresOn && !listsOn)) return undefined
    const mine = new Set<string>()
    const actingMemberId = () => actorRef.current?.id ?? ''

    const post = async (path: string): Promise<ActionResult> => {
      try {
        await client.request(path, {
          method: 'POST',
          body: { actingMemberId: actingMemberId() },
          headers: { 'Idempotency-Key': newIdempotencyKey() },
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, message: writeErrorText(error) }
      }
    }

    return {
      canCompleteChore: () => choresOn,
      canTickGroceries: listsOn,
      prepare: () => {
        if (actorRef.current && Date.now() - lastTapRef.current < ACTOR_IDLE_MS) {
          lastTapRef.current = Date.now()
          return Promise.resolve(true)
        }
        return new Promise<boolean>((resolve) => {
          resolver.current?.(false)
          resolver.current = (ok) => {
            if (ok) lastTapRef.current = Date.now()
            resolve(ok)
          }
          setPickerOpen(true)
        })
      },
      completeChore: (chore) => post(`/api/device/chores/${encodeURIComponent(chore.id)}/complete`),
      undoChore: (chore) => post(`/api/device/chores/${encodeURIComponent(chore.id)}/uncomplete`),
      choreDoneNote: () => 'A parent will check it.',
      actorLabel: () => actorRef.current?.name.trim().split(/\s+/)[0] ?? null,
      async setGroceryChecked(item, checked) {
        try {
          const op = await getDeviceQueue(client).enqueue('device.list-item.set-checked', {
            itemId: item.id,
            checked,
            actingMemberId: actingMemberId(),
          })
          mine.add(op.id)
          return { ok: true }
        } catch (error) {
          if (error instanceof QueueError && error.code === 'QUEUE_FULL') {
            return { ok: false, message: 'Too many changes are waiting for the Wi-Fi. Try again when it is back.' }
          }
          return { ok: false, message: 'Something went wrong. Try again.' }
        }
      },
      onGroceryFailed(listener) {
        const q = getDeviceQueue(client)
        return q.subscribe((event) => {
          if (event.type !== 'change') return
          for (const op of q.list()) {
            if (!mine.has(op.id)) continue
            if (op.state === 'failed' || op.state === 'conflict') {
              mine.delete(op.id)
              void q.discard(op.id)
              listener(op.payload.itemId, op.payload.checked)
            }
          }
        })
      },
      afterChange: () => afterRef.current(),
    }
  }, [client, choresOn, listsOn])

  const picker = (
    <WhoIsThisDialog
      open={pickerOpen}
      members={members}
      onPick={(m) => {
        chooseActor(m)
        settle(true)
      }}
      onClose={() => settle(false)}
    />
  )

  return { actions, actor, forgetActor: () => chooseActor(null), picker }
}

/** "Who's this?" (O-5): names and board colours only (§9.1). */
function WhoIsThisDialog({
  open,
  members,
  onPick,
  onClose,
}: {
  open: boolean
  members: BoardMember[]
  onPick: (member: DeviceActorChoice) => void
  onClose: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Who's this?"
      testId="who-is-this"
      description="Pick your name so the family knows who ticked it off."
    >
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Family members">
        {members.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => onPick({ id: m.id, name: m.name })}
              className={`flex min-h-[56px] w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-4 text-left text-[19px] font-semibold text-label-primary active:bg-[var(--surface-fill)] ${focusRing}`}
            >
              <span
                aria-hidden="true"
                className="h-5 w-5 shrink-0 rounded-full"
                style={{ backgroundColor: m.color ? MEMBER_COLOR_CSS[m.color as MemberColorKey] : 'var(--surface-fill)' }}
              />
              <span className="min-w-0 break-words">{m.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
