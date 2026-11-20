/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { PersonAvatar, PersonChip, PersonChips } from '../person-chip'
import { PersonFilter } from '../person-filter'
import { personFilterStorageKey, usePersonFilter } from '@/lib/person-filter-preference'
import type { PersonOption } from '@/lib/person-display'

describe('PersonChip', () => {
  it('prints the first name next to a decorative initial on the person colour', () => {
    render(<PersonChip name="Mia Fixture-A" color="green" />)
    const chip = screen.getByTestId('person-chip')
    expect(chip.querySelector('[data-person-name]')?.textContent).toBe('Mia')
    const avatar = chip.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(avatar.textContent).toBe('M')
    expect(avatar.getAttribute('data-member-color')).toBe('green')
  })

  it('takes visible words from the caller and draws an unknown colour as a neutral circle', () => {
    render(<PersonChip name="Casey" color="#ff0000" label="For Casey" testId="event-for" />)
    const chip = screen.getByTestId('event-for')
    expect(chip.querySelector('[data-person-name]')?.textContent).toBe('For Casey')
    const avatar = chip.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(avatar.hasAttribute('data-member-color')).toBe(false)
    expect(avatar.getAttribute('style')).toBeNull()
  })

  it('renders an avatar with a question mark for a blank name and nothing for no people', () => {
    const { container } = render(
      <>
        <PersonAvatar name="  " />
        <PersonChips people={[]} />
        <PersonChips people={null} />
      </>,
    )
    expect(container.textContent).toBe('?')
  })

  it('lists several people after a spoken label', () => {
    render(<PersonChips label="For" people={[{ name: 'Mia A', color: 'sky' }, { name: 'Casey B', color: 'pink' }]} />)
    const chips = screen.getByTestId('person-chips')
    expect(chips.textContent).toBe('For MMiaCCasey')
    expect(within(chips).getAllByTestId('person-chip')).toHaveLength(2)
  })
})

const people: PersonOption[] = [
  { key: 'account:u1', name: 'Mia Fixture-A', color: 'green' },
  { key: 'profile:m1', name: 'Casey', color: 'sky' },
  { key: 'account:u2', name: 'Sam One', color: 'pink' },
  { key: 'account:u3', name: 'Sam Two', color: 'red' },
]

function Harness({ known = people }: { known?: PersonOption[] }) {
  const [value, setValue] = usePersonFilter('chores', React.useMemo(() => known.map((p) => p.key), [known]))
  return (
    <>
      <PersonFilter people={known} value={value} onChange={setValue} label="Show chores for" everyoneLabel="Everyone" />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('PersonFilter', () => {
  beforeEach(() => window.localStorage.clear())

  it('is a labelled group of 44px toggle buttons with exactly one pressed', () => {
    render(<Harness />)
    const group = screen.getByRole('group', { name: 'Show chores for' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Everyone', 'MMia', 'CCasey', 'SSam One', 'SSam Two'])
    expect(buttons.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
    for (const button of buttons) expect(button.className).toContain('min-h-[44px]')
  })

  it('remembers the choice on this device and forgets it when Everyone is chosen', () => {
    const first = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Casey/ }))
    expect(screen.getByTestId('value').textContent).toBe('profile:m1')
    expect(screen.getByRole('button', { name: /Casey/ }).getAttribute('aria-pressed')).toBe('true')
    expect(window.localStorage.getItem(personFilterStorageKey('chores'))).toBe('profile:m1')
    first.unmount()

    render(<Harness />)
    expect(screen.getByTestId('value').textContent).toBe('profile:m1')
    fireEvent.click(screen.getByRole('button', { name: 'Everyone' }))
    expect(window.localStorage.getItem(personFilterStorageKey('chores'))).toBeNull()
  })

  it('reads a stored person who is not in this household, or a malformed value, as Everyone', () => {
    window.localStorage.setItem(personFilterStorageKey('chores'), 'account:someone-else')
    const { unmount } = render(<Harness />)
    expect(screen.getByTestId('value').textContent).toBe('all')
    unmount()
    window.localStorage.setItem(personFilterStorageKey('chores'), '<script>')
    render(<Harness />)
    expect(screen.getByTestId('value').textContent).toBe('all')
  })

  it('still works when storage is unavailable', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      render(<Harness />)
      fireEvent.click(screen.getByRole('button', { name: /Mia/ }))
      expect(screen.getByTestId('value').textContent).toBe('account:u1')
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })

  it('shows nothing with fewer than two people', () => {
    const { container } = render(<Harness known={people.slice(0, 1)} />)
    expect(container.querySelector('[data-testid="person-filter"]')).toBeNull()
  })
})
