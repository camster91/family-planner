/**
 * @jest-environment jsdom
 */
// Locations: the empty state no longer promises attaching places to pickups and
// events (no such feature), the form labels are tied to their inputs, and the
// Add and Remove buttons are 44px targets.
import '@testing-library/jest-dom'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n'
import LocationsPage from '../page'

jest.mock('@/components/providers/features-provider', () => ({
  useFeatureEnabled: () => true,
}))

function mockFetch(locations: unknown[]) {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ locations }) }) as Response) as unknown as typeof fetch
}

function renderPage(locale: 'en' | 'es' = 'en') {
  return render(
    <I18nProvider locale={locale}>
      <ToastProvider>
        <LocationsPage />
      </ToastProvider>
    </I18nProvider>
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

  it('opens a named confirmation, focuses Cancel, and does not write when cancelled', async () => {
    const user = userEvent.setup()
    mockFetch([{ id: 'l1', label: 'School', address: '1 Main St', user_id: 'u1' }])
    renderPage()

    const trigger = await screen.findByRole('button', { name: 'Remove School' })
    await user.click(trigger)

    const dialog = screen.getByRole('alertdialog', { name: 'Remove “School”?' })
    expect(dialog).toHaveTextContent('This permanently removes “School” from the family’s saved places.')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('uses the path-only DELETE contract and returns focus to Add after success', async () => {
    const user = userEvent.setup()
    mockFetch([{ id: 'l1', label: 'School', address: '1 Main St', user_id: 'u1' }])
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Remove School' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await screen.findByRole('button', { name: 'Add' })
    expect(global.fetch).toHaveBeenCalledWith('/api/locations/l1', { method: 'DELETE' })
    expect(global.fetch).toHaveBeenCalledTimes(3)
    await new Promise((resolve) => window.requestAnimationFrame(resolve))
    expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus()
  })

  it('preserves an unsaved Add draft and focuses its label after deleting a row', async () => {
    const user = userEvent.setup()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ locations: [{ id: 'l1', label: 'School', user_id: 'u1' }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ locations: [] }) }) as unknown as typeof fetch
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Add' }))
    const label = screen.getByLabelText('Label') as HTMLInputElement
    await user.clear(label)
    await user.type(label, 'After school')
    await user.click(screen.getByRole('button', { name: 'Remove School' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await screen.findByLabelText('Label')
    await new Promise((resolve) => window.requestAnimationFrame(resolve))
    expect(label).toHaveValue('After school')
    expect(label).toHaveFocus()
  })

  it('keeps the dialog open with safe retry copy after a refused delete', async () => {
    const user = userEvent.setup()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ locations: [{ id: 'l1', label: 'School', user_id: 'u1' }] }) })
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ locations: [] }) }) as unknown as typeof fetch
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Remove School' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The location could not be removed. Try again.')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('button', { name: 'Add' })
    expect(global.fetch).toHaveBeenCalledTimes(4)
  })

  it('keeps dismissal inert while a delete is in flight', async () => {
    const user = userEvent.setup()
    let resolveDelete: (value: { ok: boolean; status: number; json?: () => Promise<unknown> }) => void = () => undefined
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ locations: [{ id: 'l1', label: 'School', user_id: 'u1' }] }) })
      .mockReturnValueOnce(new Promise((resolve) => { resolveDelete = resolve })) as unknown as typeof fetch
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Remove School' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('button', { name: 'Removing…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Removing…' }))
    expect(global.fetch).toHaveBeenCalledTimes(2)

    resolveDelete({ ok: false, status: 503 })
    expect(await screen.findByRole('alert')).toHaveTextContent('The location could not be removed. Try again.')
  })

  it('uses localized confirmation and recovery copy', async () => {
    const user = userEvent.setup()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ locations: [{ id: 'l1', label: 'School', user_id: 'u1' }] }) })
      .mockRejectedValueOnce(new Error('offline')) as unknown as typeof fetch
    renderPage('es')

    await user.click(await screen.findByRole('button', { name: 'Quitar School' }))
    expect(screen.getByRole('alertdialog', { name: '¿Quitar «School»?' })).toHaveTextContent(
      'Esto quitará permanentemente «School» de los lugares guardados de la familia.',
    )
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo quitar el lugar. Revisa tu conexión e inténtalo de nuevo.',
    )
  })
})
