'use client'

import * as React from 'react'

const GET_STARTED_STORAGE_PREFIX = 'fp:get-started-hidden:'
const FEATURE_SUGGESTIONS_STORAGE_PREFIX = 'fp:feature-suggestions-hidden:'

export function getStartedStorageKey(familyId: string): string {
  return `${GET_STARTED_STORAGE_PREFIX}${familyId}`
}

export function featureSuggestionsStorageKey(familyId: string): string {
  return `${FEATURE_SUGGESTIONS_STORAGE_PREFIX}${familyId}`
}

// One store keeps same-visit Hide/Undo updates in sync between both cards.
const listeners = new Set<() => void>()

export function readVisibilityHidden(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) === '1'
  } catch {
    return false
  }
}

export function writeVisibilityHidden(storageKey: string, hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(storageKey, '1')
    else window.localStorage.removeItem(storageKey)
  } catch {
    // Not remembered; the caller still hides for this visit.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useVisibilityHidden(storageKey: string): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => readVisibilityHidden(storageKey),
    () => false
  )
}

/** Whether this household hid Get started in this browser. */
export function useGetStartedHidden(familyId: string): boolean {
  return useVisibilityHidden(getStartedStorageKey(familyId))
}

/** Whether this household hid the feature suggestions card in this browser. */
export function useFeatureSuggestionsHidden(familyId: string): boolean {
  return useVisibilityHidden(featureSuggestionsStorageKey(familyId))
}
