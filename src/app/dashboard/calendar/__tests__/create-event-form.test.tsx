/**
 * @jest-environment jsdom
 */
// New event form: a greyed-out "Create Event" says what is missing, and an end
// before the start is explained in plain words.
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

 it('saves duration after a changed start, including next-day end, and allows custom end again', async () => {
 const user = userEvent.setup()
 render(<CreateEventPage />)
 fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fixture overnight' } })
 fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2099-12-15' } })
 fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '22:30' } })
 await user.selectOptions(screen.getByLabelText('Duration'), '60')
 fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '23:30' } })
 expect(screen.queryByRole('textbox', { name: 'End time' })).toBeNull()
 fireEvent.submit(screen.getByRole('button', { name: 'Create Event' }).closest('form')!)
 await waitFor(() => expect(fetch).toHaveBeenCalled())
 const body = JSON.parse(String((fetch as jest.Mock).mock.calls[0][1].body))
 expect(+new Date(body.end_time) - +new Date(body.start_time)).toBe(3600000)
 expect(new Date(body.end_time).getDate()).toBe(16)
 await user.selectOptions(screen.getByLabelText('Duration'), '')
 expect((screen.getByLabelText('End') as HTMLInputElement).value).toBe('2099-12-16')
 expect((screen.getByLabelText('End time') as HTMLInputElement).value).toBe('00:30')
 })
 it('supports a custom duration and blocks invalid duration without a request', async () => {
 const user = userEvent.setup()
 render(<CreateEventPage />)
 fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fixture custom' } })
 fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2099-12-15' } })
 await user.selectOptions(screen.getByLabelText('Duration'), 'custom')
 fireEvent.change(screen.getByLabelText('Duration in minutes'), { target: { value: '75' } })
 fireEvent.submit(screen.getByRole('button', { name: 'Create Event' }).closest('form')!)
 await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
 const body = JSON.parse(String((fetch as jest.Mock).mock.calls[0][1].body))
 expect(+new Date(body.end_time) - +new Date(body.start_time)).toBe(75 * 60000)
 fireEvent.change(screen.getByLabelText('Duration in minutes'), { target: { value: '0' } })
 fireEvent.submit(screen.getByRole('button', { name: 'Create Event' }).closest('form')!)
 expect(await screen.findByText('Invalid date/time')).toBeTruthy()
 expect(fetch).toHaveBeenCalledTimes(1)
 })
