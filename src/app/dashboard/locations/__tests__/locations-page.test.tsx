/**
 * @jest-environment jsdom
 */
// Locations: the empty state no longer promises attaching places to pickups and
// events (no such feature), the form labels are tied to their inputs, and the
// Add and Remove buttons are 44px targets.
import '@testing-library/jest-dom'
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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

  it('shows a localized retry instead of a false empty state after the initial load fails', async () => {
    const user = userEvent.setup()
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ locations: [{ id: 'l1', label: 'School', address: null, user_id: 'u1' }] }),
      }) as unknown as typeof fetch
    renderPage('es')

    const recovery = await screen.findByTestId('locations-load-error')
    expect(recovery).toHaveTextContent('No se pudieron cargar los lugares')
    expect(screen.queryByText('No locations yet')).not.toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Intentar de nuevo' })
    expect(retry.className).toContain('min-h-[44px]')

    await user.click(retry)
    expect(await screen.findByRole('button', { name: 'Quitar School' })).toBeInTheDocument()
    expect(screen.queryByTestId('locations-load-error')).not.toBeInTheDocument()
  })

  it('rejects a malformed successful response without showing a false empty state', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ locations: [{ id: 'l1', label: 'School' }] }),
    })) as unknown as typeof fetch
    renderPage()

    expect(await screen.findByTestId('locations-load-error')).toHaveTextContent("Couldn't load locations")
    expect(screen.queryByText('No locations yet')).not.toBeInTheDocument()
  })

  it('opens the shared form dialog with labelled 44px controls', async () => {
    const user = userEvent.setup()
    mockFetch([{ id: 'l1', label: 'School', address: '1 Main St', user_id: 'u1' }])
    renderPage()
    const remove = await screen.findByRole('button', { name: 'Remove School' })
    expect(remove.className).toContain('min-h-[44px]')
    const add = screen.getByRole('button', { name: 'Add' })
    expect(add.className).toContain('min-h-[44px]')
    await user.click(add)
    const dialog = screen.getByRole('dialog', { name: 'New location' })
    expect(dialog).toHaveTextContent('Save a private place for your family.')
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Home')
    expect(screen.getByLabelText('Address')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('min-h-[44px]')
    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('min-h-[44px]')
  })

  it('edits a saved location through the parent-scoped PATCH contract', async () => {
    const user = userEvent.setup()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ locations: [{ id: 'l1', label: 'School', address: '1 Main St', user_id: 'u1' }] }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ location: { id: 'l1' } }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ locations: [{ id: 'l1', label: 'New school', address: '2 Main St', user_id: 'u1' }] }),
      }) as unknown as typeof fetch
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Edit School' }))
    expect(screen.getByRole('dialog', { name: 'Edit location' })).toBeInTheDocument()
    expect(screen.getByLabelText('Label')).toHaveValue('School')
    await user.clear(screen.getByLabelText('Label'))
    await user.type(screen.getByLabelText('Label'), 'New school')
    await user.clear(screen.getByLabelText('Address'))
    await user.type(screen.getByLabelText('Address'), '2 Main St')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/locations/l1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'New school', address: '2 Main St' }),
    })
    expect(await screen.findByRole('button', { name: 'Edit New school' })).toBeInTheDocument()
  })

  it('keeps an edit draft open when the server acknowledges a different location', async () => {
    const user = userEvent.setup()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ locations: [{ id: 'l1', label: 'School', address: '1 Main St', user_id: 'u1' }] }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ location: { id: 'different-id' } }) }) as unknown as typeof fetch
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Edit School' }))
    await user.clear(screen.getByLabelText('Label'))
    await user.type(screen.getByLabelText('Label'), 'Edited school')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('The location could not be saved. Try again.')
    expect(screen.getByRole('dialog', { name: 'Edit location' })).toBeInTheDocument()
    expect(screen.getByLabelText('Label')).toHaveValue('Edited school')
  })

  it('keeps an editor draft and pending dialog safe across a refused save', async () => {
    const user = userEvent.setup()
    let resolveSave: (value: { ok: boolean; status: number; json?: () => Promise<unknown> }) => void = () => undefined
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ locations: [] }),
      })
      .mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve }))
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ location: { id: 'l2' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ locations: [] }) }) as unknown as typeof fetch
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Add' }))
    const label = screen.getByLabelText('Label')
    await user.clear(label)
    await user.type(label, 'After school')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('dialog', { name: 'New location' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByLabelText('Label')).toBeDisabled()
    expect(screen.getByLabelText('Address')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'New location' })).toBeInTheDocument()

    resolveSave({ ok: false, status: 503, json: async () => ({}) })
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('The location could not be saved. Try again.')
    expect(label).toHaveValue('After school')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Add' })).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledTimes(4)
  })

  it('reuses the same create key and payload after a lost response', async () => {
    const user = userEvent.setup()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ locations: [] }) })
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ location: { id: 'l2' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ locations: [] }) }) as unknown as typeof fetch
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Add' }))
    await user.clear(screen.getByLabelText('Label'))
    await user.type(screen.getByLabelText('Label'), 'After school')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Try again' })
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('button', { name: 'Add' })

    const firstRequest = (global.fetch as jest.Mock).mock.calls[1]
    const retryRequest = (global.fetch as jest.Mock).mock.calls[2]
    expect(firstRequest[1].headers['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(retryRequest[1].headers['Idempotency-Key']).toBe(firstRequest[1].headers['Idempotency-Key'])
    expect(retryRequest[1].body).toBe(firstRequest[1].body)
  })

  it('starts a new create key when the failed draft changes', async () => {
    const user = userEvent.setup()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ locations: [] }) })
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ location: { id: 'l2' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ locations: [] }) }) as unknown as typeof fetch
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Add' }))
    await user.clear(screen.getByLabelText('Label'))
    await user.type(screen.getByLabelText('Label'), 'After school')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Try again' })
    await user.type(screen.getByLabelText('Address'), '2 Main')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('button', { name: 'Add' })

    const firstRequest = (global.fetch as jest.Mock).mock.calls[1]
    const changedRequest = (global.fetch as jest.Mock).mock.calls[2]
    expect(changedRequest[1].headers['Idempotency-Key']).not.toBe(firstRequest[1].headers['Idempotency-Key'])
    expect(changedRequest[1].body).not.toBe(firstRequest[1].body)
  })

  it('keeps the newest save refresh when the initial locations read resolves late', async () => {
    const user = userEvent.setup()
    let resolveInitial: (value: unknown) => void = () => undefined
    let resolveRefresh: (value: unknown) => void = () => undefined
    global.fetch = jest
      .fn()
      .mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve }))
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ location: { id: 'l2' } }) })
      .mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve })) as unknown as typeof fetch
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.clear(screen.getByLabelText('Label'))
    await user.type(screen.getByLabelText('Label'), 'After school')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3))

    resolveRefresh({
      ok: true,
      status: 200,
      json: async () => ({ locations: [{ id: 'l2', label: 'After school', address: null, user_id: 'u1' }] }),
    })
    expect(await screen.findByRole('button', { name: 'Edit After school' })).toBeInTheDocument()

    resolveInitial({
      ok: true,
      status: 200,
      json: async () => ({ locations: [{ id: 'l1', label: 'Stale school', address: null, user_id: 'u1' }] }),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByRole('button', { name: 'Edit After school' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Stale school' })).not.toBeInTheDocument()
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

  it('localizes the editor while preserving the saved label value', async () => {
    const user = userEvent.setup()
    mockFetch([{ id: 'l1', label: 'School', address: '1 Main St', user_id: 'u1' }])
    renderPage('es')

    expect(await screen.findByRole('button', { name: 'Editar School' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Editar School' }))
    expect(screen.getByRole('dialog', { name: 'Editar lugar' })).toHaveTextContent(
      'Guarda un lugar privado para tu familia.',
    )
    expect(screen.getByLabelText('Nombre')).toHaveValue('School')
    expect(screen.getByLabelText('Dirección')).toHaveValue('1 Main St')
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })
})
