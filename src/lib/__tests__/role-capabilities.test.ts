import {
  CAPTURE_CHILD_MESSAGE,
  CHILD_HANDOFF_FIELDS,
  canCreateList,
  canDeleteListOrItem,
  canEditOwnedRecord,
  canUseCapture,
  shapeHandoffForRole,
} from '../role-capabilities'

// Pins the #102 role decisions (docs/ROLE_AND_ISOLATION_MATRIX.md). Route
// handlers and pages both read these helpers, so a change here is a change to
// the matrix.

describe('role capabilities (#102)', () => {
  it('D4: capture is parent + teen; a child gets the exact refusal text', () => {
    expect(canUseCapture('parent')).toBe(true)
    expect(canUseCapture('teen')).toBe(true)
    expect(canUseCapture('child')).toBe(false)
    expect(canUseCapture(undefined)).toBe(false)
    expect(CAPTURE_CHILD_MESSAGE).toBe('Ask a parent to add this.')
  })

  it('D9: lists — create is parent + teen, delete is parent only', () => {
    expect([canCreateList('parent'), canCreateList('teen'), canCreateList('child')]).toEqual([true, true, false])
    expect([canDeleteListOrItem('parent'), canDeleteListOrItem('teen'), canDeleteListOrItem('child')]).toEqual([
      true,
      false,
      false,
    ])
  })

  it('D9: kids edit only rows they created; parents edit any', () => {
    expect(canEditOwnedRecord('child', 'u1', 'u1')).toBe(true)
    expect(canEditOwnedRecord('teen', 'u1', 'u2')).toBe(false)
    expect(canEditOwnedRecord('child', 'u1', null)).toBe(false)
    expect(canEditOwnedRecord('parent', 'u1', 'u2')).toBe(true)
  })

  describe('D2: handoff shaping', () => {
    const full = {
      id: 'h1',
      family_id: 'f',
      sitter_name: 'Sam',
      sitter_phone: '555',
      arrival_time: 'a',
      departure_time: 'd',
      code_words: 'pineapple',
      pickup_authorized: 'Gran',
      emergency_notes: 'e',
      house_notes: 'alarm',
      share_token: 'tok',
      share_expires_at: 'x',
    }

    it('parent gets every field', () => {
      expect(shapeHandoffForRole(full, 'parent')).toEqual(full)
    })

    it('teen gets everything but the share token', () => {
      const teen = shapeHandoffForRole(full, 'teen')
      expect(teen).not.toHaveProperty('share_token')
      expect(teen).not.toHaveProperty('share_expires_at')
      expect(teen).toMatchObject({ code_words: 'pineapple', sitter_phone: '555' })
    })

    it.each(['child', undefined, 'something-new'])('%s gets only the minimal fields', (role) => {
      expect(Object.keys(shapeHandoffForRole(full, role)).sort()).toEqual([...CHILD_HANDOFF_FIELDS].sort())
    })
  })
})
