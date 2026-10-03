/**
 * @jest-environment jsdom
 */
// New event form: a greyed-out "Create Event" says what is missing, and an end
// before the start is explained in plain words.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CreateEventPage from '../create/page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch
})

describe('New event form', () => {
  it('says why "Create Event" is greyed out until a title and start date are in', async () => {
    const user = userEvent.setup()
    render(<CreateEventPage />)
    const submit = screen.getByRole('button', { name: 'Create Event' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(screen.getByText('Add a title and a start date first.')).toBeTruthy()
    await user.type(screen.getByLabelText('Title'), 'Soccer')
    expect(screen.getByText('Add a start date first.')).toBeTruthy()
    await user.type(document.getElementById('startDate') as HTMLInputElement, '2099-10-05')
    expect(submit.disabled).toBe(false)
    expect(screen.queryByText(/ first\.$/)).toBeNull()
  })

  it('explains an end before the start without "date/time" jargon', async () => {
    const user = userEvent.setup()
    render(<CreateEventPage />)
    await user.type(screen.getByLabelText('Title'), 'Soccer')
    await user.type(document.getElementById('startDate') as HTMLInputElement, '2099-10-05')
    await user.type(document.getElementById('startTime') as HTMLInputElement, '17:30')
    await user.type(document.getElementById('endDate') as HTMLInputElement, '2099-10-05')
    await user.type(document.getElementById('endTime') as HTMLInputElement, '16:00')
    await user.click(screen.getByRole('button', { name: 'Create Event' }))
    expect(await screen.findByText('The end must be after the start. Check the end date and time.')).toBeTruthy()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
