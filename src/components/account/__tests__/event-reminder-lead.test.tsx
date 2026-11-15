/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import EventReminderLead from '../EventReminderLead'
import { EventRemindersProvider } from '@/components/providers/event-reminders-provider'

jest.mock('@/i18n', () => ({
  useTranslation: () => ({ t: (key: string, _params: unknown, catalogue: { en: Record<string, string> }) => catalogue.en[key] ?? key }),
}))
const server = (hours: number, saveOk = true) => jest.fn(async (_url: string, options?: RequestInit) => options?.method === 'PATCH'
  ? { ok: saveOk, json: async () => ({ supported: true, hours: JSON.parse(String(options.body)).hours }) }
  : { ok: true, json: async () => ({ supported: true, hours }) }) as unknown as typeof fetch

describe('EventReminderLead', () => {
  it('renders nothing and asks nothing when reminders are off', () => {
    global.fetch = server(24)
    const { container } = render(<EventReminderLead />)
    expect(container.innerHTML).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })
  it('shows the saved choice and saves a new one', async () => {
    global.fetch = server(24)
    render(<EventRemindersProvider enabled><EventReminderLead /></EventRemindersProvider>)
    const select = await screen.findByLabelText('Remind me about events') as HTMLSelectElement
    expect(select.value).toBe('24')
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['2 hours before', '12 hours before', '1 day before', '2 days before', '1 week before'])
    fireEvent.change(select, { target: { value: '168' } })
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2))
    const [url, options] = (global.fetch as jest.Mock).mock.calls[1]
    expect(url).toBe('/api/events/reminders')
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body)).toEqual({ hours: 168 })
    await waitFor(() => expect(select.disabled).toBe(false))
    expect(select.value).toBe('168')
  })
  it('puts the old choice back and says so when saving fails', async () => {
    global.fetch = server(24, false)
    render(<EventRemindersProvider enabled><EventReminderLead /></EventRemindersProvider>)
    const select = await screen.findByLabelText('Remind me about events') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '2' } })
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Try again.')
    expect(select.value).toBe('24')
  })
  it('stays hidden when the server says reminders are unsupported', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ supported: false, hours: 24 }) })) as unknown as typeof fetch
    const { container } = render(<EventRemindersProvider enabled><EventReminderLead /></EventRemindersProvider>)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})
