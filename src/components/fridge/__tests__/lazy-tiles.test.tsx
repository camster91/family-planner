/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { I18nProvider } from '@/i18n'
import { useIdleCover } from '../ambient'
import { AmbientCoverFallback, LazyChunkBoundary } from '../TodayBoard'

const state = { ambient: true, dim: false }

function CoveredRetrySurface({ onWake, onRetry }: { onWake: () => void; onRetry: () => void }) {
  const { covered } = useIdleCover({
    enabled: true,
    now: Date.now() + 60_000,
    display: { idleMinutes: 1, night: null },
  })
  return covered ? <AmbientCoverFallback state={state} status="error" onWake={onWake} onRetry={onRetry} /> : null
}

describe('lazy Today board surfaces', () => {
  it('keeps the board wake control accessible while the ambient chunk loads', () => {
    const onWake = jest.fn()
    render(
      <AmbientCoverFallback state={state} status="loading" onWake={onWake} />,
    )

    const cover = screen.getByTestId('ambient-cover')
    expect(cover).toHaveAttribute('role', 'dialog')
    expect(cover).toHaveAttribute('aria-modal', 'true')
    expect(cover).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading the calm display',
    )
    const show = screen.getByRole('button', { name: 'Show the board' })
    expect(show).toHaveClass('min-h-11')
    expect(show).toHaveClass('min-w-[44px]')

    fireEvent.click(show)
    expect(onWake).toHaveBeenCalledTimes(1)
  })

  it('offers a chunk retry without waking the covered board', () => {
    const onWake = jest.fn()
    const onRetry = jest.fn()
    render(
      <AmbientCoverFallback
        state={state}
        status="error"
        onWake={onWake}
        onRetry={onRetry}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('could not load')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onWake).not.toHaveBeenCalled()
  })

  it('uses the scoped Spanish copy for loading and retry controls', () => {
    render(
      <I18nProvider locale="es">
        <AmbientCoverFallback state={state} status="error" onWake={() => undefined} onRetry={() => undefined} />
      </I18nProvider>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la pantalla tranquila.')
    expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mostrar el panel' })).toBeInTheDocument()
  })

  it('lets keyboard activate the explicit retry without waking the covered board', () => {
    const onWake = jest.fn()
    const onRetry = jest.fn()
    render(<CoveredRetrySurface onWake={onWake} onRetry={onRetry} />)

    const retry = screen.getByRole('button', { name: 'Try again' })
    fireEvent.keyDown(retry, { key: 'Enter', code: 'Enter' })
    expect(onWake).not.toHaveBeenCalled()
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('turns a rejected optional chunk into a recoverable fallback', () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    function BrokenChunk(): React.ReactNode {
      throw new Error('synthetic chunk failure')
    }

    try {
      render(
        <LazyChunkBoundary fallback={<p role="alert">Try again</p>}>
          <BrokenChunk />
        </LazyChunkBoundary>,
      )
      expect(screen.getByRole('alert')).toHaveTextContent('Try again')
    } finally {
      consoleError.mockRestore()
    }
  })
})
