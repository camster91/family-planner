/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n'
const back = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ back, push: jest.fn(), refresh: jest.fn() }), useSearchParams: () => new URLSearchParams() }))
import { EventCreateSheet } from '../CalendarFormSheets'

it('uses localized sheet controls and preserves canonical event submission and pending dismissal', async () => {
  const user = userEvent.setup()
  let finish!: (r: Response) => void
  global.fetch = jest.fn(() => new Promise<Response>(resolve => { finish = resolve }))
  render(<I18nProvider locale="es"><EventCreateSheet /></I18nProvider>)
  expect(screen.getByRole('dialog', { name: 'Nuevo evento' })).toBeInTheDocument()
  await user.type(screen.getByLabelText('Título'), 'Fixture meeting')
  await user.type(screen.getByLabelText('Inicio'), '2026-12-15')
  await user.click(screen.getByRole('button', { name: 'Crear evento' }))
  expect(fetch).toHaveBeenCalledWith('/api/events', expect.objectContaining({ method: 'POST' }))
  expect(screen.queryByRole('button', { name: 'Cerrar y volver' })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(back).not.toHaveBeenCalled()
  await act(async () => finish({ ok: false, json: async () => ({ error: 'Fixture error' }) } as Response))
  expect(screen.getByRole('alert')).toHaveTextContent('Fixture error')
  await user.click(screen.getByRole('button', { name: 'Cerrar y volver' }))
  expect(back).toHaveBeenCalledTimes(1)
})
