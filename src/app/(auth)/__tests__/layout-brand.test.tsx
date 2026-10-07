/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import AuthLayout from '../layout'

jest.mock('@/components/ui/brand-illustration', () => ({ BrandMark: () => <span aria-hidden="true" />, BrandIllustration: () => <div /> }))

it('gives every auth route a branded home escape and one form landmark', () => {
  render(<AuthLayout><h1>Recover your account</h1><input aria-label="Email" /></AuthLayout>)
  expect(screen.getByRole('link', { name: 'Herewoven home' })).toHaveAttribute('href', '/')
  expect(screen.getByRole('main')).toContainElement(screen.getByRole('textbox', { name: 'Email' }))
  expect(screen.getByText('Everyday life, held together.')).toBeInTheDocument()
})
