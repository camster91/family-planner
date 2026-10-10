/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import Explore from '@/app/dashboard/meals/explore/page'
jest.mock('@/components/ui/feature-gate', () => ({ FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
const preview = { title: 'Fixture soup', description: 'A fixture recipe.', instructions: 'Stir then simmer.', ingredientLines: ['½ cup rice', 'Salt to taste'], source: 'https://example.org/soup', prep_time: 15, cook_time: 30 }
const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 422, json: async () => body })
function setup(role = 'parent') {
 const calls: unknown[] = []
 global.fetch = jest.fn(async (url, init) => {
  if (String(url) === '/api/auth/me') return response({ user: { role } })
  if (String(url).startsWith('/api/recipes?')) return response({ recipes: [{ id: 'saved-fixture', title: 'Fixture pasta', description: null }], nextOffset: null })
  if (String(url) === '/api/recipes/discover') return response({ results: [{ title: 'Fixture online soup', url: preview.source }] })
  if (String(url) === '/api/recipes/preview') return response({ recipe: preview })
  if (String(url) === '/api/recipes' && init?.method === 'POST') { const body = JSON.parse(String(init.body)); calls.push(body); return response({ recipe: { id: 'new-fixture', title: body.title } }) }
  throw new Error('unexpected fixture request')
 }) as jest.Mock
 return calls
}
it('finds source searches, reads a recipe, embeds only sandboxed original, and saves through canonical editor', async () => {
 const calls = setup(), user = userEvent.setup()
 render(<Explore />)
 await screen.findByLabelText('Recipe link')
 await user.type(screen.getByLabelText('What would you like to cook?'), 'chicken & rice')
 expect(screen.getByRole('link', { name: 'Search BBC Good Food ↗' })).toHaveAttribute('href', 'https://www.bbcgoodfood.com/search?q=chicken%20%26%20rice')
 await user.type(screen.getByLabelText('Recipe link'), preview.source)
 await user.click(screen.getByRole('button', { name: 'Read recipe' }))
 await screen.findByRole('dialog', { name: 'Fixture soup' })
 expect(screen.getByText('½ cup rice')).toBeInTheDocument()
 await user.click(screen.getByRole('button', { name: 'View original here' }))
 expect(screen.getByTitle('Original recipe: Fixture soup')).toHaveAttribute('sandbox', 'allow-scripts')
 expect(screen.getByRole('link', { name: 'Open original ↗' })).toHaveAttribute('href', preview.source)
 await user.click(screen.getByRole('button', { name: 'Recipe reader' }))
 await user.click(screen.getByRole('button', { name: 'Review and save' }))
 expect(screen.getByLabelText('Description')).toHaveValue('Source: https://example.org/soup\nA fixture recipe.')
 expect(screen.getByLabelText('Method')).toHaveValue('Ingredients\n½ cup rice\nSalt to taste\n\nStir then simmer.')
 await user.click(screen.getByRole('button', { name: /Save recipe/i }))
 await waitFor(() => expect(calls).toHaveLength(1))
 expect(calls[0]).toMatchObject({ title: 'Fixture soup', description: 'Source: https://example.org/soup\nA fixture recipe.', prep_time: 15, cook_time: 30 })
 expect((calls[0] as { ingredients?: unknown }).ingredients).toBeUndefined()
 expect(await screen.findByRole('link', { name: 'Open saved recipe' })).toHaveAttribute('href', '/dashboard/meals/recipes/new-fixture')
})
it('child reads saved box and source links but cannot import', async () => {
 setup('child'); render(<Explore />)
 await screen.findByRole('link', { name: 'Fixture pasta' })
 expect(screen.queryByLabelText('Recipe link')).toBeNull()
 expect(screen.getByRole('link', { name: 'Search Allrecipes ↗' })).toBeInTheDocument()
})
it('source errors keep the original link available and do not save', async () => {
 setup(); const baseFetch = fetch
 global.fetch = jest.fn((url, init) => String(url) === '/api/recipes/preview' ? Promise.resolve(response({ error: 'Fixture site unavailable' }, false)) : baseFetch(url, init)) as jest.Mock
 render(<Explore />)
 await screen.findByLabelText('Recipe link')
 fireEvent.change(screen.getByLabelText('Recipe link'), { target: { value: preview.source } })
 fireEvent.submit(screen.getByRole('button', { name: 'Read recipe' }).closest('form')!)
 expect(await screen.findByRole('alert')).toHaveTextContent('Fixture site unavailable')
 expect(screen.getByRole('link', { name: 'Open original ↗' })).toHaveAttribute('href', preview.source)
 expect(screen.queryByRole('dialog')).toBeNull()
})

it('searches within the app and opens a result directly in the recipe reader', async () => {
 setup(); const user = userEvent.setup(); render(<Explore />)
 await screen.findByLabelText('Recipe link')
 await user.type(screen.getByLabelText('What would you like to cook?'), 'soup')
 await user.click(screen.getByRole('button', { name: 'Search recipes' }))
 const title = await screen.findByText('Fixture online soup')
 await user.click(within(title.closest('li')!).getByRole('button', { name: 'Read recipe' }))
 expect(await screen.findByRole('dialog', { name: 'Fixture soup' })).toBeInTheDocument()
 expect(fetch).toHaveBeenCalledWith('/api/recipes/discover', expect.objectContaining({ body: JSON.stringify({ query: 'soup', source: 'BBC Good Food' }) }))
})
