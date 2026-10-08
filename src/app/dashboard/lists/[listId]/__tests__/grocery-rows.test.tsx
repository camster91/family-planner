/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import ListDetailClient from '../ListDetailClient'
import { ToastProvider } from '@/components/ui/toast'

// The offline queue (#162) is covered by its own tests and e2e/sync.spec.ts.
jest.mock('../use-list-item-sync', () => ({
  useListItemSync: () => ({
    online: true,
    durable: true,
    pendingCount: 0,
    notice: null,
    dismissNotice: () => {},
    stateFor: () => undefined,
    setChecked: async () => {},
    retry: async () => {},
    discard: async () => {},
  }),
}))

const base = { quantity: 1, category: null, added_by: { name: 'Pat' } }

describe('grocery list rows (ADR-0007, #252)', () => {
  it('shows amount, unit and recipe provenance, and groups open rows by ingredient', () => {
    render(
      <ToastProvider>
      <ListDetailClient
        listId="l1"
        listName="Groceries"
        listType="grocery"
        userId="u1"
        // Store sections (#273) off: the list keeps its #252 category order.
        sectionSort={{ enabled: false, order: [], learned: false, overrides: {}, canChange: true }}
        items={[
          { ...base, id: 'a', content: 'Tomatoes', checked: false, amount: 6, unit: null, ingredient_id: 'ing_tom', ingredient_name: 'Tomatoes', recipe_title: 'Veggie lasagna' },
          { ...base, id: 'b', content: 'Milk', checked: false, quantity: 2 },
          { ...base, id: 'c', content: 'Tomatoes', checked: false, amount: 8, unit: 'pcs', ingredient_id: 'ing_tom', ingredient_name: 'Tomatoes', recipe_title: 'Tomato soup' },
          { ...base, id: 'd', content: 'Tofu', checked: true, amount: 400, unit: 'g', ingredient_id: 'ing_tofu', recipe_title: 'Tofu stir-fry', checked_by: { name: 'Sam' } },
        ]}
      />
      </ToastProvider>
    )

    const group = screen.getByRole('group', { name: 'Tomatoes, 2 entries' })
    const grouped = within(group).getAllByRole('checkbox')
    expect(grouped.map((r) => r.textContent)).toEqual([
      expect.stringContaining('6 · from Veggie lasagna'),
      expect.stringContaining('8 pcs · from Tomato soup'),
    ])
    // The group sits where its first row was: before Milk.
    const order = screen.getAllByTestId('list-item').map((el) => el.getAttribute('data-item-id'))
    expect(order).toEqual(['a', 'c', 'b', 'd'])
    // Plain quantity still shows for manual rows; checked rows keep provenance and who ticked them.
    expect(screen.getByRole('checkbox', { name: /Milk/ }).textContent).toContain('× 2')
    expect(screen.getByRole('checkbox', { name: /Tofu/ }).textContent).toContain('400 g · from Tofu stir-fry · ✓ Sam')
  })

  it('leaves generic lists without provenance text', () => {
    render(
      <ToastProvider>
      <ListDetailClient
        listId="l2"
        listName="Weekend"
        listType="todo"
        userId="u1"
        items={[{ ...base, id: 't', content: 'Rake leaves', checked: false }]}
      />
      </ToastProvider>
    )
    const row = screen.getByRole('checkbox', { name: /Rake leaves/ })
    expect(row.textContent).toBe('Rake leaves')
    expect(screen.queryByTestId('ingredient-group')).toBeNull()
  })
})

// Canonical refresh after a queued create; navigation is covered in browser tests.
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))

// Submitted-create replay has its own real-queue component and browser suite.
jest.mock('../PersonGroceryAdd', () => ({ PersonGroceryAdd: () => null }))
