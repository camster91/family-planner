/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n'
import { toDateOnlyLocal } from '@/lib/dates'
import MealsPage from '../page'
import { ToastProvider } from '@/components/ui/toast'

jest.mock('@/components/providers/features-provider', () => ({
  useFeatureEnabled: () => true,
}))

const today = toDateOnlyLocal(new Date())
const todayIso = `${today}T00:00:00.000Z`

const LASAGNA = { id: 'r_lasagna', title: 'Veggie lasagna', prep_time: 25, cook_time: 45, servings: 6 }

type Call = { url: string; method: string; body: unknown }

function setup({
  meals,
  mealsStatus = 200,
  saveError,
}: {
  meals: unknown[]
  mealsStatus?: number
  /** Answer meal POST/PATCH with this status and server error. */
  saveError?: { status: number; error: string }
}) {
  const calls: Call[] = []
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    const json = (status: number, data: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response
    if (url.startsWith('/api/meals?')) return json(mealsStatus, mealsStatus === 200 ? { meals } : { error: 'boom' })
    if (url.startsWith('/api/recipes')) return json(200, { recipes: [LASAGNA], nextOffset: null })
    if (saveError && (method === 'POST' || method === 'PATCH') && url.startsWith('/api/meals'))
      return json(saveError.status, { error: saveError.error })
    if (url === '/api/meals' && method === 'POST') return json(201, { meal: { id: 'new' } })
    if (url.startsWith('/api/meals/') && method === 'PATCH') return json(200, { meal: { id: 'x' } })
    if (url.startsWith('/api/meals/') && method === 'DELETE') return json(200, { success: true })
    return json(404, {})
  })
  global.fetch = fetchMock as unknown as typeof fetch
  window.confirm = jest.fn(() => false)
  window.alert = jest.fn()
  render(
    <I18nProvider>
      <ToastProvider>
        <MealsPage />
      </ToastProvider>
    </I18nProvider>
  )
  return { calls, fetchMock }
}

const dinnerA = { id: 'meal_a', meal_type: 'dinner', recipe_name: 'Tacos', notes: null, date: todayIso, recipe: null }
const dinnerB = { id: 'meal_b', meal_type: 'dinner', recipe_name: 'Green salad', notes: null, date: todayIso, recipe: null }

async function todayCard() {
  const cards = await screen.findAllByTestId('meal-day')
  return cards.find((c) => c.getAttribute('data-day') === today)!
}

describe('/dashboard/meals', () => {
  it("links to the food inventory when it is on (#263)", async () => {
    setup({ meals: [] })
    const link = await screen.findByRole('link', { name: "What's in the fridge" })
    expect(link.getAttribute('href')).toBe('/dashboard/inventory')
  })

  it('shows every meal in a slot, each editable and deletable (gap 2.4.1)', async () => {
    const user = userEvent.setup()
    const { calls } = setup({ meals: [dinnerA, dinnerB] })
    const card = await todayCard()
    const rows = within(card).getAllByTestId('meal-row')
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Tacos'), expect.stringContaining('Green salad')])
    // One "add another" control for the slot, named for the meal type and day.
    expect(within(card).getAllByRole('button', { name: /^Add another dinner,/ })).toHaveLength(1)

    await user.click(rows[1])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Recipe name')).toHaveProperty('value', 'Green salad')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe('/api/meals/meal_b?id=meal_b')
    // Undo over confirm (#269): no confirm dialog; Undo re-creates the meal.
    expect(window.confirm).not.toHaveBeenCalled()
    const toast = await screen.findByTestId('undo-toast')
    expect(toast.textContent).toContain('Deleted Green salad')
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/meals' && c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.url === '/api/meals' && c.method === 'POST')!.body).toEqual({
      date: today,
      meal_type: 'dinner',
      recipe_name: 'Green salad',
    })
  })

  it('edits the second meal of a slot with the old free-text body (no recipe_id)', async () => {
    const user = userEvent.setup()
    const { calls } = setup({ meals: [dinnerA, dinnerB] })
    const card = await todayCard()
    await user.click(within(card).getAllByTestId('meal-row')[1])
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByLabelText('Recipe name')
    await user.clear(name)
    await user.type(name, 'Caesar salad')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.url).toBe('/api/meals/meal_b')
    expect(patch.body).toEqual({ id: 'meal_b', date: today, meal_type: 'dinner', recipe_name: 'Caesar salad', notes: null })
  })

  it('clears notes when they are emptied on edit (sends null, not nothing)', async () => {
    const user = userEvent.setup()
    const { calls } = setup({ meals: [{ ...dinnerA, notes: 'Extra cheese' }] })
    const card = await todayCard()
    await user.click(within(card).getAllByTestId('meal-row')[0])
    const dialog = await screen.findByRole('dialog')
    const notes = within(dialog).getByLabelText('Notes (optional)')
    expect((notes as HTMLTextAreaElement).value).toBe('Extra cheese')
    await user.clear(notes)
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual(
      expect.objectContaining({ id: 'meal_a', notes: null })
    )
  })

  it('keeps edited notes when they are changed', async () => {
    const user = userEvent.setup()
    const { calls } = setup({ meals: [{ ...dinnerA, notes: 'Extra cheese' }] })
    const card = await todayCard()
    await user.click(within(card).getAllByTestId('meal-row')[0])
    const dialog = await screen.findByRole('dialog')
    const notes = within(dialog).getByLabelText('Notes (optional)')
    await user.clear(notes)
    await user.type(notes, 'No onions')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual(expect.objectContaining({ notes: 'No onions' }))
  })

  it('adds a free-text meal from an empty slot exactly as before', async () => {
    const user = userEvent.setup()
    const { calls } = setup({ meals: [] })
    const card = await todayCard()
    await user.click(within(card).getByRole('button', { name: /^Add breakfast,/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Recipe name'), 'Porridge')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ date: today, meal_type: 'breakfast', recipe_name: 'Porridge' })
  })

  it('adds a meal with a recipe: the name fills from the recipe and recipe_id is sent', async () => {
    const user = userEvent.setup()
    const { calls } = setup({ meals: [] })
    const card = await todayCard()
    await user.click(within(card).getByRole('button', { name: /^Add dinner,/ }))
    const dialog = await screen.findByRole('dialog')
    const picker = within(dialog).getByLabelText('Recipe (optional)')
    await within(dialog).findByRole('option', { name: 'Veggie lasagna' })
    await user.selectOptions(picker, 'r_lasagna')
    expect(within(dialog).getByLabelText('Recipe name')).toHaveProperty('value', 'Veggie lasagna')
    expect(within(dialog).getByRole('link', { name: 'View recipe' }).getAttribute('href')).toBe('/dashboard/meals/recipes/r_lasagna')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      date: today,
      meal_type: 'dinner',
      recipe_name: 'Veggie lasagna',
      recipe_id: 'r_lasagna',
    })
  })

  it('shows the linked recipe and prep time on the meal row, and can unlink it', async () => {
    const user = userEvent.setup()
    const linked = { ...dinnerA, recipe_name: 'Veggie lasagna', recipe_id: LASAGNA.id, recipe: LASAGNA }
    const { calls } = setup({ meals: [linked] })
    const card = await todayCard()
    const row = within(card).getByTestId('meal-row')
    expect(row.textContent).toContain('Dinner · Recipe · 25 min prep')
    await user.click(row)
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Recipe (optional)'), '')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ recipe_id: null, recipe_name: 'Veggie lasagna' })
  })

  it('offers "Add to groceries" only for the saved recipe link, not an unsaved picker change', async () => {
    const user = userEvent.setup()
    const linked = { ...dinnerA, recipe_name: 'Veggie lasagna', recipe_id: LASAGNA.id, recipe: LASAGNA }
    setup({ meals: [linked] })
    const card = await todayCard()
    await user.click(within(card).getByTestId('meal-row'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Add ingredients to groceries' })).toBeTruthy()
    await user.selectOptions(within(dialog).getByLabelText('Recipe (optional)'), '')
    expect(within(dialog).queryByRole('button', { name: 'Add ingredients to groceries' })).toBeNull()
  })

  it('shows an error state with a working retry', async () => {
    const user = userEvent.setup()
    const { fetchMock } = setup({ meals: [], mealsStatus: 500 })
    expect(await screen.findByText('Could not load meals')).toBeTruthy()
    const before = fetchMock.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before))
  })

  it('writes the meal type in text on empty slots (not icon-only)', async () => {
    setup({ meals: [] })
    const card = await todayCard()
    for (const label of ['Breakfast', 'Lunch', 'Dinner', 'Snack']) {
      expect(within(card).getByText(label)).toBeTruthy()
    }
    expect(within(card).getAllByText('Nothing planned')).toHaveLength(4)
  })

  it("shows the server's reason in a toast when a save fails, not alert(), and keeps the dialog open", async () => {
    const user = userEvent.setup()
    setup({ meals: [], saveError: { status: 400, error: 'Recipe name is too long' } })
    const card = await todayCard()
    await user.click(within(card).getByRole('button', { name: /^Add breakfast,/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Recipe name'), 'Porridge')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Recipe name is too long')).toBeTruthy()
    expect(screen.getByText("Couldn't add the meal")).toBeTruthy()
    expect(window.alert).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('says to check the connection when a save cannot reach the server', async () => {
    const user = userEvent.setup()
    const { fetchMock } = setup({ meals: [dinnerA] })
    const card = await todayCard()
    await user.click(within(card).getByTestId('meal-row'))
    const dialog = await screen.findByRole('dialog')
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch')
    })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText("Couldn't save the meal")).toBeTruthy()
    expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
    expect(window.alert).not.toHaveBeenCalled()
  })
})
