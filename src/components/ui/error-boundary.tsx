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
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    // Exception messages/stacks can contain household content or provider data.
    log.error('ui.error_boundary', describeError(error))
  }

  render() {
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
