import { emergencyRelationshipKey } from '../emergency-viewer-label'

const card = (relationship: string, person_id: string | null = null, person_name = 'Someone') => ({
  relationship,
  person_id,
  person_name,
})

const members = [
  { id: 'mom', role: 'parent' },
  { id: 'teen1', role: 'teen' },
  { id: 'kid1', role: 'child' },
  { id: 'kid2', role: 'child' },
]

describe('emergency relationship labels', () => {
  it('keeps the stored, parent-side wording for parents and unknown viewers', () => {
    const parent = { id: 'mom', role: 'parent' }
    expect(emergencyRelationshipKey(card('self', 'mom'), parent, members)).toBe('emergency.relationships.self')
    expect(emergencyRelationshipKey(card('child', 'kid1'), parent, members)).toBe('emergency.relationships.child')
    expect(emergencyRelationshipKey(card('child'), null)).toBe('emergency.relationships.child')
  })

  it('labels cards from a child viewer’s side', () => {
    const kid = { id: 'kid1', role: 'child', name: 'Emma' }
    expect(emergencyRelationshipKey(card('child', 'kid1'), kid, members)).toBe('emergency.viewer.you')
    expect(emergencyRelationshipKey(card('self', 'mom'), kid, members)).toBe('emergency.viewer.parent')
    expect(emergencyRelationshipKey(card('spouse'), kid, members)).toBe('emergency.viewer.parent')
    expect(emergencyRelationshipKey(card('parent'), kid, members)).toBe('emergency.viewer.grandparent')
    // A linked sibling shows their role; sex is not stored, so never Brother/Sister.
    expect(emergencyRelationshipKey(card('child', 'teen1'), kid, members)).toBe('emergency.viewer.teen')
    expect(emergencyRelationshipKey(card('child', 'kid2'), kid, members)).toBe('emergency.viewer.child')
    expect(emergencyRelationshipKey(card('other'), kid, members)).toBe('emergency.viewer.other')
  })

  it('recognises an unlinked card with the viewer’s own name', () => {
    const teen = { id: 'teen1', role: 'teen', name: 'Alex' }
    expect(emergencyRelationshipKey(card('child', null, ' alex '), teen)).toBe('emergency.viewer.you')
    expect(emergencyRelationshipKey(card('child', null, 'Jordan'), teen)).toBe('emergency.viewer.sibling')
  })

  it('falls back to the card when member roles are unavailable', () => {
    const teen = { id: 'teen1', role: 'teen' }
    expect(emergencyRelationshipKey(card('self', 'mom'), teen, [])).toBe('emergency.viewer.parent')
    expect(emergencyRelationshipKey(card('child', 'kid2'), teen, [])).toBe('emergency.viewer.sibling')
  })
})
