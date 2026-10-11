/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { I18nProvider } from '@/i18n'
import { LazySetupCard } from '../TodaySetup'

type CardProps = { label: string }

describe('deferred Today setup cards', () => {
  it('focuses each retry after rejected imports and restores focus after a successful retry', async () => {
    const user = userEvent.setup()
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    let imports = 0
    const createCard = () =>
      React.lazy(async () => {
        imports += 1
        if (imports < 3) throw new Error('synthetic setup chunk rejection')
        return {
          default: ({ label }: CardProps) => <p data-testid="loaded-setup-card">{label}</p>,
        }
      })

    try {
      render(
        <I18nProvider locale="en">
          <LazySetupCard createCard={createCard} cardProps={{ label: 'Ready' }} />
        </I18nProvider>,
      )

      const firstRetry = await screen.findByRole('button', { name: 'Try again' })
      expect(firstRetry).toHaveFocus()
      await user.keyboard('{Enter}')

      const secondRetry = await screen.findByRole('button', { name: 'Try again' })
      await waitFor(() => expect(secondRetry).toHaveFocus())
      expect(imports).toBe(2)
      await user.keyboard('{Enter}')

      expect(await screen.findByTestId('loaded-setup-card')).toHaveTextContent('Ready')
      await waitFor(() => expect(screen.getByTestId('today-setup-region')).toHaveFocus())
      expect(imports).toBe(3)
    } finally {
      consoleError.mockRestore()
    }
  })
})
