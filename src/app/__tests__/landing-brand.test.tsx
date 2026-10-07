/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import Home from '../page'
import { I18nProvider } from '@/i18n'

jest.mock('@/components/ui/brand-illustration', () => ({ BrandMark: () => <span aria-hidden="true" />, BrandIllustration: ({ source }: { source: { src: string } }) => <div data-testid="approved-graphic" data-src={source.src} /> }))

it('introduces Herewoven with real account routes and an explicitly illustrative day', () => {
  render(<I18nProvider><Home /></I18nProvider>)
  expect(screen.getByRole('heading', { level: 1, name: 'Everyday life, held together.' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Herewoven home' })).toHaveAttribute('href', '/')
  expect(screen.getAllByRole('link', { name: /Create your household/i }).every(link => link.getAttribute('href') === '/register')).toBe(true)
  expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  expect(screen.getByRole('region', { name: 'Example household day' })).toHaveTextContent('Illustrative preview · fictional household')
  expect(screen.getByTestId('approved-graphic')).toHaveAttribute('data-src', '/brand/woven-grove/graphics/herewoven-woven-graphic.svg')
  expect(document.body).not.toHaveTextContent(/Free Forever|Free during the beta|No payment details|Any Device/i)
})
