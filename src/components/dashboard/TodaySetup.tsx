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

type SetupCardFactory<Props> = () => React.LazyExoticComponent<React.ComponentType<Props>>

type LazySetupCardProps<Props> = {
  createCard: SetupCardFactory<Props>
  cardProps: Props
}

class SetupChunkBoundary extends React.Component<SetupChunkBoundaryProps, SetupChunkBoundaryState> {
  state: SetupChunkBoundaryState = { failed: false }

  static getDerivedStateFromError(): SetupChunkBoundaryState {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function SetupChunkFallback({
  status,
  onRetry,
  retryRef,
}: {
  status: 'loading' | 'error'
  onRetry?: () => void
  retryRef?: React.RefObject<HTMLButtonElement>
}) {
  const text = useTodayBoardText()

  React.useEffect(() => {
    if (status === 'error') retryRef?.current?.focus({ preventScroll: true })
  }, [retryRef, status])

  return (
    <div
      role={status === 'error' ? 'alert' : 'status'}
      aria-busy={status === 'loading' ? 'true' : undefined}
      className="flex min-h-14 items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-4"
    >
      <span>{status === 'loading' ? text('setupLoading') : text('setupError')}</span>
      {status === 'error' && onRetry && (
        <button
          ref={retryRef}
          type="button"
          className="btn-secondary min-h-[44px] min-w-[44px]"
          onClick={onRetry}
        >
          {text('retry')}
        </button>
      )}
    </div>
  )
}

function createGetStarted() {
  return React.lazy(() => import('./GetStarted'))
}

function LoadedSetupCard({ onLoaded, children }: { onLoaded: () => void; children: React.ReactNode }) {
  React.useEffect(() => onLoaded(), [onLoaded])
  return children
}

export function LazySetupCard<Props>({ createCard, cardProps }: LazySetupCardProps<Props>) {
  const [attempt, setAttempt] = React.useState(0)
  const [Card, setCard] = React.useState(createCard)
  const retryRef = React.useRef<HTMLButtonElement>(null)
  const regionRef = React.useRef<HTMLDivElement>(null)
  const restoreFocusOnLoadRef = React.useRef(false)

  const onLoaded = React.useCallback(() => {
    if (!restoreFocusOnLoadRef.current) return
    restoreFocusOnLoadRef.current = false
    regionRef.current?.focus({ preventScroll: true })
  }, [])

  const retry = React.useCallback(() => {
    restoreFocusOnLoadRef.current = true
    setCard(createCard())
    setAttempt((value) => value + 1)
  }, [createCard])
  return (
    <div ref={regionRef} tabIndex={-1} data-testid="today-setup-region" className="min-w-0">
      <SetupChunkBoundary
        key={attempt}
        fallback={<SetupChunkFallback status="error" onRetry={retry} retryRef={retryRef} />}
      >
        <React.Suspense fallback={<SetupChunkFallback status="loading" />}>
          <LoadedSetupCard onLoaded={onLoaded}>
            {React.createElement(Card as unknown as React.ComponentType<never>, cardProps as never)}
          </LoadedSetupCard>
        </React.Suspense>
      </SetupChunkBoundary>
    </div>
  )
}

function createFeatureSuggestions() {
  return React.lazy(() => import('./FeatureSuggestions'))
}

function LazyGetStarted({ viewer, familyId, steps }: GetStartedProps) {
  return <LazySetupCard createCard={createGetStarted} cardProps={{ viewer, familyId, steps }} />
}

function LazyFeatureSuggestions({
  viewer,
  familyId,
  setupDone,
  initialPicked,
}: FeatureSuggestionsProps) {
  return (
    <LazySetupCard
      createCard={createFeatureSuggestions}
      cardProps={{ viewer, familyId, setupDone, initialPicked }}
    />
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
