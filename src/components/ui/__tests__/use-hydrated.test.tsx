/**
 * @jest-environment jsdom
 */
// useHydrated / useLocalNow / useTodayKey (O-31): unknown (false / null) on the
// server and during hydration, the viewer's values right after; already known
// for a component mounted after hydration, so client navigations never flash
// the neutral form.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { useHydrated, useLocalNow, useTodayKey } from '../use-hydrated'
import { serverRenderThenHydrate, type Hydrated } from './ssr-hydration'

function Probe() {
  const hydrated = useHydrated()
  const now = useLocalNow()
  const today = useTodayKey()
  return <p data-testid="probe">{`${hydrated}|${now ? now.getHours() : 'none'}|${today ?? 'none'}`}</p>
}

let hydrated: Hydrated | null = null
beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  hydrated?.unmount()
  hydrated = null
  jest.useRealTimers()
})

describe('useHydrated', () => {
  it('is false on the server, true after hydration, with no mismatch', () => {
    hydrated = serverRenderThenHydrate(<Probe />, {
      serverNow: new Date(2026, 9, 1, 23, 59, 30),
      clientNow: new Date(2026, 9, 2, 0, 0, 30),
    })
    expect(hydrated.html).toContain('false|none|none')
    expect(hydrated.errors).toEqual([])
    expect(hydrated.recoverable).toEqual([])
    expect(screen.getByTestId('probe').textContent).toBe('true|0|2026-10-02')
  })

  it('is true at once for a client-only mount', () => {
    jest.setSystemTime(new Date(2026, 9, 2, 8, 15))
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('true|8|2026-10-02')
  })
})
