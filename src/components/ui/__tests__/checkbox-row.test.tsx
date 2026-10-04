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

describe('CheckboxRow subtitle', () => {
  it('wraps to at most two lines by default instead of truncating', () => {
    render(<CheckboxRow checked={false} onChange={() => {}} title="Unload dishwasher" subtitle={SUBTITLE} />)
    const sub = screen.getByText(SUBTITLE)
    expect(sub.className).toContain('line-clamp-2')
    expect(sub.className).toContain('break-words')
    expect(sub.className).not.toContain('truncate')
  })

  it('keeps the title on one line by default', () => {
    render(<CheckboxRow checked={false} onChange={() => {}} title="Unload dishwasher" subtitle={SUBTITLE} />)
    expect(screen.getByText('Unload dishwasher').className).toContain('truncate')
  })

  it('does the same in the control-only variant, which is described by the subtitle', () => {
    render(
      <CheckboxRow checked={false} onChange={() => {}} toggleArea="control" title="Unload dishwasher" subtitle={SUBTITLE} />
    )
    expect(screen.getByText(SUBTITLE).className).toContain('line-clamp-2')
    expect(screen.getByRole('checkbox', { description: SUBTITLE })).toBeTruthy()
  })

  it('with `wrap`, lets title and subtitle grow without a line limit', () => {
    render(<CheckboxRow checked={false} onChange={() => {}} wrap title="Milk" subtitle={SUBTITLE} />)
    expect(screen.getByText(SUBTITLE).className).not.toContain('line-clamp-2')
    expect(screen.getByText('Milk').className).toContain('break-words')
  })
})
