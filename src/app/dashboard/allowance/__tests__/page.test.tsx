/** @jest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/toast'
import AllowancePage from '../page'

jest.mock('@/components/providers/features-provider', () => ({
  useFeatureEnabled: () => true,
}))

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

function renderPage() {
  return render(
    <ToastProvider>
      <AllowancePage />
    </ToastProvider>,
  )
}

describe('allowance member roster recovery', () => {
  it('keeps the add form disabled and preserves its draft while a failed roster load is retried', async () => {
    const user = userEvent.setup()
    let memberAttempts = 0
    global.fetch = jest.fn(async (url: string) => {
      if (url === '/api/auth/me') return response({ user: { role: 'parent' } })
      if (url === '/api/allowance') return response({ items: [] })
      if (url === '/api/family/members') {
        memberAttempts += 1
        if (memberAttempts === 1) throw new Error('offline')
        return response({ members: [{ id: 'kid-1', name: 'Sam', avatar_url: null }] })
      }
      return response({})
    }) as unknown as typeof fetch

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Add' }))
    await screen.findByRole('alert')
    await user.type(screen.getByLabelText('Amount'), '10.00')
    await user.type(screen.getByLabelText('Reason'), 'Weekly allowance')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Sam' })).toBeTruthy())
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('10')
    expect((screen.getByLabelText('Reason') as HTMLInputElement).value).toBe('Weekly allowance')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('treats a malformed successful roster response as an error instead of an empty roster', async () => {
    const user = userEvent.setup()
    let memberAttempts = 0
    global.fetch = jest.fn(async (url: string) => {
      if (url === '/api/auth/me') return response({ user: { role: 'parent' } })
      if (url === '/api/allowance') return response({ items: [] })
      if (url === '/api/family/members') {
        memberAttempts += 1
        return memberAttempts === 1
          ? response({ members: [{ id: 'missing-name' }] })
          : response({ members: [{ id: 'kid-1', name: 'Sam' }] })
      }
      return response({})
    }) as unknown as typeof fetch

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Add' }))
    expect(await screen.findByText("Couldn't load family members. Try again.")).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Sam' })).toBeNull()
  })
})
