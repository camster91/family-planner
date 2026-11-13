/** @jest-environment jsdom */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { EventPeoplePicker } from '../EventPeoplePicker'
import { EventPeopleLine } from '../EventPeopleLine'
import type { EventPersonRef } from '@/lib/event-participants'

jest.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, params: Record<string, string> | undefined, catalogue: { en: Record<string, string> }) =>
      (catalogue.en[key] ?? key).replace(/\{(\w+)\}/g, (_: string, name: string) => params?.[name] ?? ''),
  }),
}))

const people = [
  { kind: 'account', id: 'u1', name: 'Avery', color: 'green' },
  { kind: 'profile', id: 'm1', name: 'Kid', color: 'sky' },
]
const reply = (body: unknown, ok = true) => jest.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch

function Harness({ onAvailability }: { onAvailability: (v: boolean) => void }) {
  const React = require('react') as typeof import('react')
  const [value, setValue] = React.useState<EventPersonRef[]>([])
  return (<><EventPeoplePicker value={value} onChange={setValue} onAvailability={onAvailability} /><pre data-testid="value">{JSON.stringify(value)}</pre></>)
}

describe('EventPeoplePicker', () => {
  it('offers the household, toggles people and reports the choice in words', async () => {
    global.fetch = reply({ supported: true, people })
    const available = jest.fn()
    render(<Harness onAvailability={available} />)
    const avery = await screen.findByRole('button', { name: /Avery/ })
    expect(available).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('group', { name: 'Who is it for?' })).toBeTruthy()
    expect(avery.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('status').textContent).toBe('Optional. Leave empty for the whole family.')
    fireEvent.click(avery)
    fireEvent.click(screen.getByRole('button', { name: /Kid/ }))
    expect(screen.getByRole('button', { name: /Avery/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('value').textContent).toBe('[{"kind":"account","id":"u1"},{"kind":"profile","id":"m1"}]')
    expect(screen.getByRole('status').textContent).toBe('For Avery, Kid')
    fireEvent.click(screen.getByRole('button', { name: /Avery/ }))
    expect(screen.getByTestId('value').textContent).toBe('[{"kind":"profile","id":"m1"}]')
  })

  it.each([
    ['the capability is off', { supported: false, people: [] }, true],
    ['the read fails', { error: 'x' }, false],
    ['the reply is malformed', { supported: true, people: [{ kind: 'account', id: 'u1', name: 'Avery', color: 'not-a-colour' }] }, true],
    ['a person is listed twice', { supported: true, people: [people[0], people[0]] }, true],
  ])('renders nothing and reports unavailable when %s', async (_label, body, ok) => {
    global.fetch = reply(body, ok)
    const available = jest.fn()
    const { container } = render(<Harness onAvailability={available} />)
    await waitFor(() => expect(available).toHaveBeenCalledWith(false))
    expect(container.querySelector('fieldset')).toBeNull()
  })

  it('renders nothing for a household with no people, but stays available', async () => {
    global.fetch = reply({ supported: true, people: [] })
    const available = jest.fn()
    const { container } = render(<Harness onAvailability={available} />)
    await waitFor(() => expect(available).toHaveBeenCalledWith(true))
    expect(container.querySelector('fieldset')).toBeNull()
  })
})

describe('EventPeopleLine', () => {
  it('names the people in text, with colour as decoration only', () => {
    render(<EventPeopleLine people={people} label="For" />)
    const line = screen.getByTestId('event-people-line')
    expect(line.getAttribute('aria-label')).toBe('For Avery, Kid')
    expect(line.textContent).toBe('AveryKid')
  })
  it('renders nothing without people', () => {
    const { container } = render(<><EventPeopleLine people={[]} label="For" /><EventPeopleLine people={undefined} label="For" /></>)
    expect(container.innerHTML).toBe('')
  })
})
