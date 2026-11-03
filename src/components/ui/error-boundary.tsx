'use client'

import { Component, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useSharedControlsText } from '@/i18n/shared-controls'
import { describeError, log } from '@/lib/logger'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  navigation: unknown
}

/**
 * Next.js signals notFound(), redirect(), forbidden() and unauthorized() by
 * throwing an error with a reserved digest. Those belong to the framework's
 * own boundaries; catching them here showed "Something went wrong" for a
 * missing project or a turned-off settings page (#499).
 */
export function isNextNavigationSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest
  return (
    typeof digest === 'string' &&
    (digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;') ||
      digest.startsWith('NEXT_REDIRECT') ||
      digest === 'NEXT_NOT_FOUND')
  )
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, navigation: null }
  }

  static getDerivedStateFromError(error: unknown): State {
    if (isNextNavigationSignal(error)) return { hasError: false, navigation: error }
    return { hasError: true, navigation: null }
  }

  componentDidCatch(error: Error) {
    if (isNextNavigationSignal(error)) return
    // Exception messages/stacks can contain household content or provider data.
    log.error('ui.error_boundary', describeError(error))
  }

  render() {
    // Hand framework navigation back to Next.js's boundaries.
    if (this.state.navigation) throw this.state.navigation
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return <DefaultErrorFallback onRetry={() => this.setState({ hasError: false })} />
    }

    return this.props.children
  }
}

/** Hook-based chrome keeps locale changes independent of the caught subtree. */
function DefaultErrorFallback({ onRetry }: { onRetry: () => void }) {
  const text = useSharedControlsText()
  return (
    <div role="alert" className="flex flex-col items-center justify-center p-8 text-center">
      <AlertTriangle className="w-12 h-12 text-warning-text mb-4" aria-hidden="true" />
      <h3 className="text-lg font-semibold text-foreground mb-2">{text('errorTitle')}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">{text('errorMessage')}</p>
      <button type="button" onClick={onRetry} className="btn-primary min-h-11 flex items-center gap-2">
        <RefreshCw className="w-4 h-4" aria-hidden="true" />
        {text('tryAgain')}
      </button>
    </div>
  )
}
