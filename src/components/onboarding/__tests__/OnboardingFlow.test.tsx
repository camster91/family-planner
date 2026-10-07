/**
 * @jest-environment jsdom
 */
// Onboarding for a signed-in member with no household. A child, teen or second
// parent who registered without their invite link must be able to reach the
// join page from here, not only "Create Family".
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

import OnboardingFlow from '../OnboardingFlow'

describe('OnboardingFlow', () => {
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
