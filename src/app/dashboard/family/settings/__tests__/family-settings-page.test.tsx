/**
 * @jest-environment jsdom
 */
// Family settings showed Timezone and Currency selects that were never saved,
// then said "Family settings updated successfully!". They are gone (per-household
// time zone is deferred, decision O-31; there is no currency field), and the
// message now says only what was saved: the family name.
import * as React from 'react'
import '@testing-library/jest-dom'
import { act, fireEvent, render as renderUi, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FamilySettingsPage from '../page'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n'
function render(ui: React.ReactElement) {
  return renderUi(<I18nProvider locale="en"><ToastProvider>{ui}</ToastProvider></I18nProvider>)
}

jest.mock('@/components/fridge/BoardSettings', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/account/DeleteAccountDialog', () => ({ __esModule: true, default: () => null }))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}))

type Call = { url: string; method: string; body: any }

function mockFetch(patch: { status: number; body: unknown }) {
  const calls: Call[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as Response
    if (url === '/api/auth/me') {
      return reply(200, { user: { role: 'parent', family_id: 'fam_1', family: { name: 'Rivera' } } })
    }
    if (url === '/api/family/name' && method === 'PATCH') return reply(patch.status, patch.body)
    return reply(404, {})
  }) as unknown as typeof fetch
  return calls
}

describe('/dashboard/family/settings', () => {
  it('has no unsaved Timezone or Currency controls', async () => {
    mockFetch({ status: 200, body: {} })
    render(<FamilySettingsPage />)
    expect(await screen.findByLabelText('Family name')).toBeTruthy()
    expect(screen.queryByLabelText(/time ?zone/i)).toBeNull()
    expect(screen.queryByLabelText(/currency/i)).toBeNull()
  })

  it('saves the family name and says only that', async () => {
    const user = userEvent.setup()
    const calls = mockFetch({ status: 200, body: { family: { id: 'fam_1', name: 'Rivera-Lee' } } })
    render(<FamilySettingsPage />)
    const input = await screen.findByLabelText('Family name')
    await user.clear(input)
    await user.type(input, 'Rivera-Lee')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect((await within(screen.getByLabelText('Family name').closest('form')!).findByRole('status')).textContent).toBe('Family name saved.')
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ name_protocol: 1, familyId: 'fam_1', name: 'Rivera-Lee', baseName: 'Rivera' })
  })

  it("keeps the draft and shows a fixed safe alert when the save fails", async () => {
    const user = userEvent.setup()
    mockFetch({ status: 403, body: { error: 'Only parents can update family settings' } })
    render(<FamilySettingsPage />)
    await screen.findByLabelText('Family name')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Could not save the family name. Your entry is still here.')
    )
    expect(within(screen.getByLabelText('Family name').closest('form')!).queryByRole('status')).toBeNull()
    expect(screen.getByLabelText('Family name')).toHaveValue('Rivera')
  })
})

// A 200 response alone is not proof that this household's requested name saved.
it.each([{}, { family: { id: 'other-household', name: 'Rivera' } }, { family: { id: 'fam_1', name: 'Different' } }])('rejects an unconfirmed name receipt: %j', async body => {
  mockFetch({ status: 200, body })
  render(<FamilySettingsPage />)
  await screen.findByLabelText('Family name')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the family name. Your entry is still here.')
  expect(within(screen.getByLabelText('Family name').closest('form')!).queryByRole('status')).toBeNull()
  expect(screen.getByLabelText('Family name')).toHaveValue('Rivera')
})

// Current-name review and deadline cases authored UNRUN.
it('retains the typed name after a conflict and requires explicit current-name review', async () => {
  let current = 'Rivera'; const writes: any[] = [];
  global.fetch = jest.fn(async (url, init) => {
    const reply = (status: number, body: unknown) => ({ ok: status === 200, status, json: async () => body }) as Response;
    if (String(url) === '/api/auth/me') return reply(200, { user: { role: 'parent', family_id: 'fam_1', family: { name: current } } });
    writes.push(JSON.parse(String(init?.body)));
    if (writes.length === 1) { current = 'Another parent'; return reply(409, { code: 'FAMILY_NAME_CHANGED' }); }
    return reply(200, { family: { id: 'fam_1', name: writes[1].name } });
  }) as typeof fetch;
  const user = userEvent.setup(); render(<FamilySettingsPage />);
  const field = await screen.findByLabelText('Family name');
  await user.clear(field); await user.type(field, 'My draft');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText(/The household name changed elsewhere/);
  expect(field).toHaveValue('My draft');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Check current name' }));
  await screen.findByText('Current saved name: Another parent');
  expect(field).toHaveValue('My draft'); expect(writes).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Family name saved.');
  expect(writes[0].baseName).toBe('Rivera'); expect(writes[1].baseName).toBe('Another parent');
});
it('releases a stalled name reply and never treats its late body as confirmation', async () => {
  let late!: (value: unknown) => void;
  global.fetch = jest.fn(async url => String(url) === '/api/auth/me'
    ? { ok: true, status: 200, json: async () => ({ user: { role: 'parent', family_id: 'fam_1', family: { name: 'Rivera' } } }) } as Response
    : { ok: true, status: 200, json: () => new Promise(resolve => { late = resolve; }) } as Response) as typeof fetch;
  render(<FamilySettingsPage />); await screen.findByLabelText('Family name');
  jest.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(15001); });
    expect(screen.getByRole('alert')).toHaveTextContent('Your entry is still here.');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await act(async () => { late({ family: { id: 'fam_1', name: 'Rivera' } }); });
    expect(screen.queryByText('Family name saved.')).toBeNull();
    expect(screen.getByLabelText('Family name')).toHaveValue('Rivera');
  } finally { jest.useRealTimers(); }
});
