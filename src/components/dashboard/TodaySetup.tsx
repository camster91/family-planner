'use client'

import * as React from 'react'
import { useFeatures } from '@/components/providers/features-provider'
import { useTodayBoardText } from '@/i18n/today-board'
import { allStepsDone, type GetStartedSteps } from '@/app/dashboard/today/get-started-data'
import { pickFeatureSuggestionKeys } from './feature-suggestion-keys'
import {
  useFeatureSuggestionsHidden,
  useGetStartedHidden,
} from './get-started-visibility'
import type { GetStartedProps } from './GetStarted'
import type { FeatureSuggestionsProps } from './FeatureSuggestions'

type TodaySetupProps = {
  viewer: { id: string; role: string }
  familyId: string
  steps: GetStartedSteps
}

type SetupChunkBoundaryProps = {
  children: React.ReactNode
  fallback: React.ReactNode
}

type SetupChunkBoundaryState = { failed: boolean }

class SetupChunkBoundary extends React.Component<SetupChunkBoundaryProps, SetupChunkBoundaryState> {
  state: SetupChunkBoundaryState = { failed: false }

  static getDerivedStateFromError(): SetupChunkBoundaryState {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function SetupChunkFallback({ status, onRetry }: { status: 'loading' | 'error'; onRetry?: () => void }) {
  const text = useTodayBoardText()
  return (
    <div
      role={status === 'error' ? 'alert' : 'status'}
      aria-busy={status === 'loading' ? 'true' : undefined}
      className="flex min-h-14 items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-4"
    >
      <span>{status === 'loading' ? text('setupLoading') : text('setupError')}</span>
      {status === 'error' && onRetry && (
        <button type="button" className="btn-secondary min-h-[44px] min-w-[44px]" onClick={onRetry}>
          {text('retry')}
        </button>
      )}
    </div>
  )
}

function createGetStarted() {
  return React.lazy(() => import('./GetStarted'))
}

function LazyGetStarted({ viewer, familyId, steps }: GetStartedProps) {
  const [attempt, setAttempt] = React.useState(0)
  const [GetStartedCard, setGetStartedCard] = React.useState(createGetStarted)
  const retry = React.useCallback(() => {
    setGetStartedCard(createGetStarted())
    setAttempt((value) => value + 1)
  }, [])

  return (
    <SetupChunkBoundary
      key={attempt}
      fallback={<SetupChunkFallback status="error" onRetry={retry} />}
    >
      <React.Suspense fallback={<SetupChunkFallback status="loading" />}>
        <GetStartedCard viewer={viewer} familyId={familyId} steps={steps} />
      </React.Suspense>
    </SetupChunkBoundary>
  )
}

function createFeatureSuggestions() {
  return React.lazy(() => import('./FeatureSuggestions'))
}

function LazyFeatureSuggestions({
  viewer,
  familyId,
  setupDone,
  initialPicked,
}: FeatureSuggestionsProps) {
  const [attempt, setAttempt] = React.useState(0)
  const [FeatureSuggestionsCard, setFeatureSuggestionsCard] = React.useState(createFeatureSuggestions)
  const retry = React.useCallback(() => {
    setFeatureSuggestionsCard(createFeatureSuggestions())
    setAttempt((value) => value + 1)
  }, [])

  return (
    <SetupChunkBoundary
      key={attempt}
      fallback={<SetupChunkFallback status="error" onRetry={retry} />}
    >
      <React.Suspense fallback={<SetupChunkFallback status="loading" />}>
        <FeatureSuggestionsCard
          viewer={viewer}
          familyId={familyId}
          setupDone={setupDone}
          initialPicked={initialPicked}
        />
      </React.Suspense>
    </SetupChunkBoundary>
  )
}

/** Defers the optional onboarding cards until their server and browser gates pass. */
export default function TodaySetup({ viewer, familyId, steps }: TodaySetupProps) {
  const { features, canManage } = useFeatures()
  const getStartedHidden = useGetStartedHidden(familyId)
  const featureSuggestionsHidden = useFeatureSuggestionsHidden(familyId)
  const [initialPicked] = React.useState(() => pickFeatureSuggestionKeys(features))
  const setupDone = allStepsDone(steps)
  const isParent = viewer.role === 'parent'

  if (!isParent) return null

  const showGetStarted = !setupDone && !getStartedHidden
  const showFeatureSuggestions =
    canManage && (setupDone || getStartedHidden) && !featureSuggestionsHidden && initialPicked.length > 0

  return (
    <div className="mt-6 space-y-4">
      {showGetStarted && <LazyGetStarted viewer={viewer} familyId={familyId} steps={steps} />}
      {showFeatureSuggestions && (
        <LazyFeatureSuggestions
          viewer={viewer}
          familyId={familyId}
          setupDone={setupDone}
          initialPicked={initialPicked}
        />
      )}
    </div>
  )
}
