/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import TodayBoardPage from '../page'

jest.mock('next/server', () => ({ after: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ getServerUser: async () => ({ id: 'p' }) }))
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: async () => ({ role: 'parent', family_id: 'f' }) } } }))
jest.mock('@/lib/calendar-import/sync', () => ({ refreshStaleSubscriptions: jest.fn() }))
jest.mock('@/lib/recurringChores', () => ({ topUpHouseholdSeries: jest.fn() }))
jest.mock('../board-snapshot', () => ({ loadTodayBoard: async () => ({}) }))
jest.mock('../home-summary-data', () => ({ loadHomeSummary: async () => ({}) }))
jest.mock('../get-started-data', () => ({ allStepsDone: () => false, loadGetStarted: async () => ({}) }))
jest.mock('@/components/fridge/TodayBoard', () => ({ __esModule: true, default: () => <div data-testid="board" /> }))
jest.mock('@/components/dashboard/HomeSummary', () => ({ __esModule: true, default: () => <div data-testid="summary" /> }))
jest.mock('@/components/dashboard/GetStarted', () => ({ __esModule: true, default: () => <div data-testid="setup" /> }))
jest.mock('@/components/dashboard/FeatureSuggestions', () => ({ __esModule: true, default: () => <div data-testid="suggestions" /> }))

it('puts household plans before optional setup so Today is content-first', async () => {
  render(await TodayBoardPage({ searchParams: Promise.resolve({}) }))
  expect(screen.getByTestId('board').compareDocumentPosition(screen.getByTestId('setup')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByTestId('summary').compareDocumentPosition(screen.getByTestId('board')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
