/**
 * @jest-environment jsdom
 */
// Picture picker for the chore editor (#272): searchable, labelled, >= 44px
// targets, selection in text as well as outline, and every catalogue key drawn.
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoutineFields, RoutineIconPicker, routineRequestFields } from '../RoutineIconPicker'
import { DRAWN_ICON_KEYS, RoutineIcon } from '../RoutineIcon'
import { ROUTINE_ICON_KEYS, ROUTINE_ICONS } from '@/lib/routine-icons'

function Harness({ initial = null as string | null, onChange = jest.fn() }) {
  const [value, setValue] = React.useState<string | null>(initial)
  return (
    <RoutineIconPicker
      value={value}
      onChange={(k) => {
        setValue(k)
        onChange(k)
      }}
    />
  )
}

describe('RoutineIcon drawings', () => {
  it('draws every catalogue key and nothing else', () => {
    expect([...DRAWN_ICON_KEYS].sort()).toEqual([...ROUTINE_ICON_KEYS].sort())
  })

  it('is decorative by default and named when given a title; unknown keys fall back', () => {
    const { container, rerender } = render(<RoutineIcon icon="brush-teeth" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('data-icon')).toBe('brush-teeth')
    rerender(<RoutineIcon icon="brush-teeth" title="Brush teeth" />)
    expect(screen.getByRole('img', { name: 'Brush teeth' })).toBeTruthy()
    rerender(<RoutineIcon icon="made-up" />)
    expect(container.querySelector('svg')!.getAttribute('data-icon')).toBe('none')
  })
})

describe('RoutineIconPicker', () => {
  it('lists every picture as a labelled button plus "No picture"', () => {
    render(<Harness />)
    const group = screen.getByRole('group', { name: 'Picture' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons).toHaveLength(ROUTINE_ICONS.length + 1)
    expect(within(group).getByRole('button', { name: 'No picture' }).getAttribute('aria-pressed')).toBe('true')
    for (const icon of ROUTINE_ICONS) {
      const b = within(group).getByRole('button', { name: icon.label })
      // Touch target: at least 64 wide and 76 tall by class (>= 44px).
      expect(b.className).toMatch(/min-h-\[76px\]/)
      expect(b.className).toMatch(/min-w-\[64px\]/)
    }
  })

  it('selects a picture, says so in text, and a second tap clears it', async () => {
    const onChange = jest.fn()
    render(<Harness onChange={onChange} />)
    const teeth = screen.getByRole('button', { name: 'Brush teeth' })
    await userEvent.click(teeth)
    expect(onChange).toHaveBeenLastCalledWith('brush-teeth')
    expect(teeth.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Selected: Brush teeth')).toBeTruthy()

    await userEvent.click(teeth)
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(teeth.getAttribute('aria-pressed')).toBe('false')
  })

  it('filters by name and keyword, and says when nothing matches', async () => {
    render(<Harness />)
    const search = screen.getByRole('searchbox', { name: 'Search pictures' })
    await userEvent.type(search, 'toothbrush')
    const group = screen.getByRole('group', { name: 'Picture' })
    expect(within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Brush teeth',
    ])
    await userEvent.clear(search)
    await userEvent.type(search, 'dog')
    expect(within(group).getByRole('button', { name: 'Feed the pet' })).toBeTruthy()
    expect(within(group).getByRole('button', { name: 'Walk the dog' })).toBeTruthy()
    await userEvent.clear(search)
    await userEvent.type(search, 'spaceship')
    expect(within(group).queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe('No pictures match “spaceship”.')
  })

  it('keeps an existing selection pressed', () => {
    render(<Harness initial="shoes" />)
    expect(screen.getByRole('button', { name: 'Shoes' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'No picture' }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('RoutineFields', () => {
  it('labels the routine and step fields and enables the step only with a routine', async () => {
    function F() {
      const [routine, setRoutine] = React.useState('')
      const [order, setOrder] = React.useState('')
      return <RoutineFields routine={routine} onRoutineChange={setRoutine} order={order} onOrderChange={setOrder} />
    }
    render(<F />)
    const step = screen.getByLabelText('Step') as HTMLInputElement
    expect(step.disabled).toBe(true)
    await userEvent.type(screen.getByLabelText('Routine'), 'Morning')
    expect(step.disabled).toBe(false)
  })

  it('builds the request fields', () => {
    expect(routineRequestFields(' Morning ', '2')).toEqual({ routine: 'Morning', routine_order: 2 })
    expect(routineRequestFields('Morning', '')).toEqual({ routine: 'Morning', routine_order: null })
    expect(routineRequestFields('', '3')).toEqual({ routine: null, routine_order: null })
  })
})
