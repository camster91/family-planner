/**
 * @jest-environment jsdom
 */
// Printing a handoff used to give a blank page: the print stylesheet hides
// everything except `.print-card`, and nothing had that class. Print now marks
// the chosen card (and only it) before opening the print dialog.
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/toast'

const mockT = (key: string) => key
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT }) }))
jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import HandoffPage from '../page'

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response

let printSpy: jest.SpyInstance
let classesAtPrint: Record<string, boolean>[]

beforeEach(() => {
  classesAtPrint = []
  printSpy = jest.spyOn(window, 'print').mockImplementation(() => {
    classesAtPrint.push({
      h1: screen.getByTestId('handoff-card-h1').classList.contains('print-card'),
      h2: screen.getByTestId('handoff-card-h2').classList.contains('print-card'),
    })
  })
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/auth/me') return reply({ user: { id: 'p1', role: 'parent' } })
    if (url === '/api/handoff')
      return reply({
        handoffs: [
          { id: 'h1', sitter_name: 'Sarah', arrival_time: null, departure_time: null },
          { id: 'h2', sitter_name: 'Mia', arrival_time: null, departure_time: null },
        ],
      })
    return reply({})
  }) as unknown as typeof fetch
})

afterEach(() => printSpy.mockRestore())

it('prints only the chosen card and clears the mark after printing', async () => {
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <HandoffPage />
    </ToastProvider>
  )
  await screen.findByText('Mia')
  expect(document.querySelectorAll('.print-card')).toHaveLength(0)

  const printButtons = screen.getAllByRole('button', { name: 'handoff.print' })
  await user.click(printButtons[1])

  expect(printSpy).toHaveBeenCalledTimes(1)
  expect(classesAtPrint[0]).toEqual({ h1: false, h2: true })

  act(() => {
    window.dispatchEvent(new Event('afterprint'))
  })
  expect(document.querySelectorAll('.print-card')).toHaveLength(0)

  // The same card can be printed again.
  await user.click(printButtons[1])
  expect(printSpy).toHaveBeenCalledTimes(2)
  expect(classesAtPrint[1]).toEqual({ h1: false, h2: true })
})
