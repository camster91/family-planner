/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import { ChoreFormSection } from '../ChoreFormSection'
it('opens a closed optional section when a field is invalid so validation can reach it', () => {
  const {container} = render(<ChoreFormSection title="Details" summary="Optional"><input aria-label="Points" type="number" min="1" /></ChoreFormSection>)
  expect(container.querySelector('details')?.open).toBe(false)
  fireEvent.invalid(screen.getByLabelText('Points'))
  expect(container.querySelector('details')?.open).toBe(true)
})
