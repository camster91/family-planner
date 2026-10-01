// Test helper (not a test file): render a component the way the server does
// (renderToString), then hydrate that HTML in jsdom the way the browser does,
// collecting any hydration mismatch React reports.
//
// The server and browser disagree about "now" in two ways (O-31): the server
// runs in UTC and the browser in the viewer's zone, and the browser hydrates a
// little later than the server rendered. Jest cannot switch the process time
// zone mid-run (process.env.TZ is sandboxed), so these tests use the second:
// the server renders at `serverNow` and the browser hydrates at `clientNow`,
// on either side of local midnight. Anything that depends on the viewer's day
// or clock then differs between the two renders, exactly as a zone gap would.
import * as React from 'react'
import { TextEncoder } from 'util'
import { hydrateRoot, type Root } from 'react-dom/client'
import { act } from '@testing-library/react'

export interface Hydrated {
  /** The server HTML (the pre-mount render). */
  html: string
  container: HTMLElement
  /** console.error calls during hydration (React logs mismatches here). */
  errors: string[]
  /** Errors React recovered from by client-rendering (mismatches). */
  recoverable: unknown[]
  unmount: () => void
}

/**
 * Server-render `ui` with the clock at `serverNow`, then hydrate it with the
 * clock at `clientNow`. Needs `jest.useFakeTimers()` in the calling test.
 */
export function serverRenderThenHydrate(
  ui: React.ReactElement,
  { serverNow, clientNow }: { serverNow: Date; clientNow: Date }
): Hydrated {
  // jsdom lacks TextEncoder, which react-dom/server's browser build needs at load.
  if (typeof globalThis.TextEncoder === 'undefined') {
    ;(globalThis as { TextEncoder?: unknown }).TextEncoder = TextEncoder
  }
  const { renderToString } = require('react-dom/server') as typeof import('react-dom/server')

  jest.setSystemTime(serverNow)
  const html = renderToString(ui)
  jest.setSystemTime(clientNow)

  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)

  const errors: string[] = []
  const recoverable: unknown[] = []
  const spy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  })
  let root: Root | undefined
  try {
    act(() => {
      root = hydrateRoot(container, ui, { onRecoverableError: (error) => recoverable.push(error) })
    })
  } finally {
    spy.mockRestore()
  }

  return {
    html,
    container,
    errors,
    recoverable,
    unmount: () => {
      act(() => root?.unmount())
      container.remove()
    },
  }
}
