/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import KidHome from '../KidHome'
import { ToastProvider } from '@/components/ui/toast'
import { FeaturesProvider } from '@/components/providers/features-provider'
import { defaultFeatures } from '@/lib/features'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))

beforeAll(() => {
  // jsdom has no media playback; retain the actual BrandMotion component.
  window.HTMLMediaElement.prototype.play = jest.fn(() => Promise.resolve())
  window.HTMLMediaElement.prototype.pause = jest.fn()
})

it('uses the English viewer’s regional clock for a local-today event', () => {
  const languages = jest.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB'])
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 30)
  try {
    render(
      <FeaturesProvider initial={defaultFeatures()}>
        <ToastProvider>
          <KidHome user={{ name: 'Casey', role: 'child' }} chores={[]} events={[{ id: 'e1', title: 'Library', start_time: start.toISOString(), location: 'Town' }]} rewards={[]} />
        </ToastProvider>
      </FeaturesProvider>,
    )
    const events = screen.getByText('Coming up').closest('section') as HTMLElement
    expect(within(events).getByText('15:30 · Town')).toBeTruthy()
    expect(within(events).getByText('Today')).toBeTruthy()
    expect(within(events).queryByText(/3:30 PM/)).toBeNull()
  } finally { languages.mockRestore() }
})
