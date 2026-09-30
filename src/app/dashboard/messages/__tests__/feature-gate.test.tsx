/**
 * @jest-environment jsdom
 */
// Messages page (route inventory F-2): with Family chat off the page shows the
// calm "is off" state and never calls /api/messages (which would answer 403).
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import MessagesPage from '../page'
import { FeaturesProvider } from '@/components/providers/features-provider'
import { defaultFeatures } from '@/lib/features'

let fetchMock: jest.Mock

beforeAll(() => {
  // jsdom has no scrollIntoView; the chat scrolls to the newest message.
  Element.prototype.scrollIntoView = jest.fn()
})

beforeEach(() => {
  fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ messages: [], members: [], userId: 'u1' }),
  }))
  global.fetch = fetchMock as unknown as typeof fetch
})

function renderWith(messages: boolean) {
  return render(
    <FeaturesProvider initial={{ ...defaultFeatures(), messages }}>
      <MessagesPage />
    </FeaturesProvider>
  )
}

it('shows the off state and never fetches messages when Family chat is off', () => {
  const { unmount } = renderWith(false)
  expect(screen.getByRole('heading', { name: 'Family chat is off' })).toBeTruthy()
  expect(fetchMock).not.toHaveBeenCalled()
  unmount()
})

it('loads messages when Family chat is on', async () => {
  const { unmount } = renderWith(true)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/messages'))
  expect(screen.queryByText('Family chat is off')).toBeNull()
  unmount()
})
