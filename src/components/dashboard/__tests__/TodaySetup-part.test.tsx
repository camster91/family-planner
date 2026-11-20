/**
 * @jest-environment jsdom
 */
// Today mounts setup twice: "Get started" first on the page while it is
// incomplete, "Turn on more" suggestions at the end. Each mount shows only
// its own card, so neither appears twice.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import TodaySetup from '../TodaySetup'
import { getStartedStorageKey } from '../get-started-visibility'

jest.mock('@/components/providers/features-provider', () => ({
  useFeatures: () => ({ features: {}, canManage: true }),
}))
jest.mock('../feature-suggestion-keys', () => ({ pickFeatureSuggestionKeys: () => ['rewards'] }))
jest.mock('../GetStarted', () => ({ __esModule: true, default: () => <p data-testid="card-get-started" /> }))
jest.mock('../FeatureSuggestions', () => ({ __esModule: true, default: () => <p data-testid="card-suggestions" /> }))

const viewer = { id: 'p', role: 'parent' }
const open = { invited: false, hasChore: false, hasEvent: false, hasCalendar: false }
const done = { invited: true, hasChore: true, hasEvent: true, hasCalendar: true }

beforeEach(() => window.localStorage.clear())

it('the top mount shows an unfinished Get started and never the suggestions', async () => {
  const view = render(<TodaySetup viewer={viewer} familyId="f" steps={open} part="getStarted" />)
  expect(await screen.findByTestId('card-get-started')).toBeTruthy()
  expect(screen.queryByTestId('card-suggestions')).toBeNull()
  view.unmount()

  // Finished: nothing at the top of Today (the suggestions mount takes over).
  const { container } = render(<TodaySetup viewer={viewer} familyId="f" steps={done} part="getStarted" />)
  expect(container.innerHTML).toBe('')
})

it('the bottom mount shows only the suggestions, once Get started is done or hidden', async () => {
  const view = render(<TodaySetup viewer={viewer} familyId="f" steps={open} part="suggestions" />)
  expect(view.container.innerHTML).toBe('')
  view.unmount()

  window.localStorage.setItem(getStartedStorageKey('f'), '1')
  render(<TodaySetup viewer={viewer} familyId="f" steps={open} part="suggestions" />)
  expect(await screen.findByTestId('card-suggestions')).toBeTruthy()
  expect(screen.queryByTestId('card-get-started')).toBeNull()
})

it('shows nothing to a teen or child', () => {
  const { container } = render(
    <TodaySetup viewer={{ id: 't', role: 'teen' }} familyId="f" steps={open} part="getStarted" />,
  )
  expect(container.innerHTML).toBe('')
})
