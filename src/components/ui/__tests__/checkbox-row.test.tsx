/**
 * @jest-environment jsdom
 */
// CheckboxRow subtitle (who / when / "Takes turns · next: Alex"): at phone
// width it wraps onto a second line instead of being cut off on one, and is
// clamped at two lines so a very long one does not grow the row forever.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { CheckboxRow } from '../checkbox-row'

const SUBTITLE = 'Avery · Due today · Takes turns · next: Jordan'

describe('CheckboxRow accessibility', () => {
  it('describes the control-only checkbox using its subtitle', () => {
    render(
      <CheckboxRow checked={false} onChange={() => {}} toggleArea="control" title="Unload dishwasher" subtitle={SUBTITLE} />
    )
    expect(screen.getByRole('checkbox', { description: SUBTITLE })).toBeTruthy()
  })
})
