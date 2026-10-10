/**
 * @jest-environment jsdom
 */
// Onboarding for a signed-in member with no household. A child, teen or second
// parent who registered without their invite link must be able to reach the
// join page from here, not only "Create Family".
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

import OnboardingFlow from '../OnboardingFlow'

describe('OnboardingFlow', () => {
  afterEach(() => jest.restoreAllMocks())
  it('welcomes the family by the product name', () => {
    render(<OnboardingFlow userId="u1" />)
    expect(screen.getByRole('heading', { name: 'Welcome to Herewoven!' })).toBeTruthy()
  })

  it('offers joining an existing family next to creating one', async () => {
    render(<OnboardingFlow userId="u1" />)
    await userEvent.click(screen.getByRole('button', { name: /get started/i }))
    expect(screen.getByRole('button', { name: /create family/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /join an existing family/i }).getAttribute('href')).toBe('/join')
  })
})


describe('family creation next step', () => {
  afterEach(() => jest.restoreAllMocks())

  async function enterFamily() {
    render(<OnboardingFlow userId="u1" />)
    await userEvent.click(screen.getByRole('button', { name: /get started/i }))
    await userEvent.type(screen.getByRole('textbox', { name: /family name/i }), 'Our Family')
  }

  it('prompts adding everyone after the successful canonical creation', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ family: { id: 'f1' } }) })
    await enterFamily()
    await userEvent.click(screen.getByRole('button', { name: /create family/i }))
    expect(await screen.findByRole('heading', { name: /add everyone/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /add family members/i }).getAttribute('href')).toBe('/dashboard/family/invite')
    expect(screen.getByRole('link', { name: /finish later/i }).getAttribute('href')).toBe('/dashboard')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/family', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Our Family' }) }))
  })

  it('retains the draft on server failure and permits retry', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Try again' }) })
    await enterFamily()
    await userEvent.click(screen.getByRole('button', { name: /create family/i }))
    expect(await screen.findByText('Try again')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: /family name/i }) as HTMLInputElement).value).toBe('Our Family')
    expect(screen.queryByRole('heading', { name: /add everyone/i })).toBeNull()
    await waitFor(() => expect((screen.getByRole('button', { name: /create family/i }) as HTMLButtonElement).disabled).toBe(false))
  })
})
