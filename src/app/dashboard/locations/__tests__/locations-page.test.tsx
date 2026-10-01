/**
 * @jest-environment jsdom
 */
// Locations: the empty state no longer promises attaching places to pickups and
// events (no such feature), the form labels are tied to their inputs, and the
// Add and Remove buttons are 44px targets.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/toast'
import LocationsPage from '../page'

jest.mock('@/components/providers/features-provider', () => ({
  useFeatureEnabled: () => true,
}))

function mockFetch(locations: unknown[]) {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ locations }) }) as Response) as unknown as typeof fetch
}

function renderPage() {
  return render(
    <ToastProvider>
      <LocationsPage />
    </ToastProvider>
  )
}

describe('/dashboard/locations', () => {
  it('does not promise attaching locations to pickups and events', async () => {
    mockFetch([])
    renderPage()
    expect(await screen.findByText('No locations yet')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/attach them/i)
  })

  it('labels the form fields and uses 44px buttons', async () => {
    const user = userEvent.setup()
    mockFetch([{ id: 'l1', label: 'School', address: '1 Main St', user_id: 'u1' }])
    renderPage()
    const remove = await screen.findByRole('button', { name: 'Remove School' })
    expect(remove.className).toContain('min-h-[44px]')
    const add = screen.getByRole('button', { name: 'Add' })
    expect(add.className).toContain('min-h-[44px]')
    await user.click(add)
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Home')
    expect(screen.getByLabelText('Address')).toBeTruthy()
  })
})
