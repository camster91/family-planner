'use client'

import * as React from 'react'
import type { PersonFilterValue } from './person-display'

/**
 * The person filter a device last chose on a screen ("Everyone" or one
 * person). Device presentation only: it is never sent to the server, and a
 * stored person who is not in the household list shown now reads as
 * "Everyone", so a stale or foreign value can never hide items.
 */
export type PersonFilterSurface = 'calendar' | 'chores'

const STORAGE_PREFIX = 'fp:person-filter:v1:'
/** `account:<id>` or `profile:<id>`, bounded. Anything else is ignored. */
const KEY_PATTERN = /^(account|profile):[A-Za-z0-9_-]{1,128}$/

export function personFilterStorageKey(surface: PersonFilterSurface): string {
  return `${STORAGE_PREFIX}${surface}`
}

export function readPersonFilter(surface: PersonFilterSurface): PersonFilterValue {
  try {
    const value = window.localStorage.getItem(personFilterStorageKey(surface))
    return value && KEY_PATTERN.test(value) ? value : 'all'
  } catch {
    return 'all'
  }
}

export function writePersonFilter(surface: PersonFilterSurface, value: PersonFilterValue): void {
  try {
    if (value === 'all' || !KEY_PATTERN.test(value)) window.localStorage.removeItem(personFilterStorageKey(surface))
    else window.localStorage.setItem(personFilterStorageKey(surface), value)
  } catch {
    // Not remembered; the choice still applies on this visit.
  }
}

/**
 * The remembered filter for a screen. The first render is always "Everyone"
 * (server HTML and hydration match); the stored choice applies after mount.
 * `known` is the set of person keys on the screen: a choice outside it reads
 * as "Everyone" without being forgotten, so it comes back when that person
 * does.
 */
export function usePersonFilter(
  surface: PersonFilterSurface,
  known: ReadonlyArray<string>,
): [PersonFilterValue, (next: PersonFilterValue) => void] {
  const [chosen, setChosen] = React.useState<PersonFilterValue>('all')
  React.useEffect(() => {
    setChosen(readPersonFilter(surface))
  }, [surface])
  const choose = React.useCallback(
    (next: PersonFilterValue) => {
      setChosen(next)
      writePersonFilter(surface, next)
    },
    [surface],
  )
  const value = chosen !== 'all' && known.includes(chosen) ? chosen : 'all'
  return [value, choose]
}
