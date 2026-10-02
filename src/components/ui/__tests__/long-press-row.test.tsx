/**
 * @jest-environment jsdom
 */
// LongPressRow: the action sheet opens on press and hold and, without a
// pointer, from the focus-revealed "More actions" button, the ContextMenu key,
// Shift+F10 and right click. The sheet is a modal dialog that takes focus,
// closes on Escape and gives focus back.
import '@testing-library/jest-dom'
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LongPressRow } from '../long-press-row'

function setup(onEdit = jest.fn()) {
  render(
    <>
      <LongPressRow
        itemName="Unload dishwasher"
        actions={[
          { label: 'Edit', onClick: onEdit },
          { label: 'Delete', onClick: jest.fn(), destructive: true },
        ]}
      >
        <a href="#row">Unload dishwasher</a>
      </LongPressRow>
      <button type="button">After</button>
    </>
  )
  return { onEdit }
}

const trigger = () => screen.getByRole('button', { name: 'More actions for Unload dishwasher' })
const dialog = () => screen.queryByRole('dialog', { name: 'More actions for Unload dishwasher' })

describe('LongPressRow', () => {
  it('reaches the menu from the keyboard and returns focus on Escape', async () => {
    const user = userEvent.setup()
    setup()
    await user.tab() // the row's link
    await user.tab() // the focus-revealed menu button
    expect(trigger()).toHaveFocus()
    expect(trigger()).toHaveTextContent('More actions')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')

    await user.keyboard('{Enter}')
    expect(dialog()).toBeInTheDocument()
    expect(dialog()).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(dialog()).not.toBeInTheDocument()
    await waitFor(() => expect(trigger()).toHaveFocus())
  })

  it('keeps Tab inside the open sheet', async () => {
    const user = userEvent.setup()
    setup()
    trigger().focus()
    await user.keyboard('{Enter}')
    await user.tab() // Delete
    await user.tab() // Cancel
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.tab() // wraps to Edit
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('opens with the ContextMenu key and Shift+F10 from inside the row', () => {
    setup()
    const link = screen.getByRole('link', { name: 'Unload dishwasher' })
    link.focus()
    fireEvent.keyDown(link, { key: 'ContextMenu' })
    expect(dialog()).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(dialog()).not.toBeInTheDocument()

    fireEvent.keyDown(link, { key: 'F10', shiftKey: true })
    expect(dialog()).toBeInTheDocument()
  })

  it('opens on right click and on press and hold, and runs the chosen action', () => {
    jest.useFakeTimers()
    try {
      const { onEdit } = setup()
      const link = screen.getByRole('link', { name: 'Unload dishwasher' })
      fireEvent.contextMenu(link)
      expect(dialog()).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      act(() => jest.runOnlyPendingTimers())

      fireEvent.pointerDown(link)
      act(() => jest.advanceTimersByTime(499))
      expect(dialog()).not.toBeInTheDocument()
      act(() => jest.advanceTimersByTime(1))
      expect(dialog()).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      expect(onEdit).toHaveBeenCalledTimes(1)
      expect(dialog()).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('with showMenuButton, a visible ⋯ button opens the sheet without starting a hold', async () => {
    const user = userEvent.setup()
    const onRowClick = jest.fn()
    render(
      <LongPressRow showMenuButton itemName="Unload dishwasher" actions={[{ label: 'Edit', onClick: jest.fn() }]}>
        <button type="button" onClick={onRowClick}>Unload dishwasher</button>
      </LongPressRow>
    )
    // One menu button, shown as an icon (no focus-only text), named for the row.
    expect(screen.getAllByRole('button', { name: /More actions/ })).toHaveLength(1)
    expect(trigger()).toHaveTextContent('')
    expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog')
    await user.click(trigger())
    expect(dialog()).toBeInTheDocument()
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(onRowClick).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger()).toHaveFocus())
  })

  it('does not open when the press is released early', () => {
    jest.useFakeTimers()
    try {
      setup()
      const link = screen.getByRole('link', { name: 'Unload dishwasher' })
      fireEvent.pointerDown(link)
      act(() => jest.advanceTimersByTime(200))
      fireEvent.pointerUp(link)
      act(() => jest.advanceTimersByTime(1000))
      expect(dialog()).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })
})
