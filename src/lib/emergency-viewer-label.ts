/**
 * Emergency cards store a relationship from the parent's point of view
 * ("self", "child", "spouse", "parent", "other"). A teen or child reading the
 * cards should see it from their own side: "You" on their own card, "Parent"
 * for the parents, and so on. Sex is not stored, so siblings are never called
 * "Brother" or "Sister"; a linked sibling shows their role instead.
 */
export type EmergencyViewer = {
  id: string
  role: string
  name?: string | null
}

export type EmergencyMember = { id: string; role: string }

type CardRelation = {
  person_id: string | null
  person_name: string
  relationship: string
}

const PARENT_RELATIONSHIPS = new Set(['self', 'child', 'spouse', 'parent', 'other'])

function sameName(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
}

/** The i18n key for a card's relationship label as this viewer should see it. */
export function emergencyRelationshipKey(
  card: CardRelation,
  viewer: EmergencyViewer | null,
  members: readonly EmergencyMember[] = [],
): string {
  const parentView = `emergency.relationships.${PARENT_RELATIONSHIPS.has(card.relationship) ? card.relationship : 'other'}`
  // Parents, and anyone whose role is not known yet, keep the stored wording.
  if (!viewer || (viewer.role !== 'teen' && viewer.role !== 'child')) return parentView

  if (card.person_id && card.person_id === viewer.id) return 'emergency.viewer.you'
  const linked = card.person_id ? members.find((member) => member.id === card.person_id) : undefined
  if (linked) {
    if (linked.role === 'parent') return 'emergency.viewer.parent'
    if (linked.role === 'teen') return 'emergency.viewer.teen'
    if (linked.role === 'child') return 'emergency.viewer.child'
  }

  switch (card.relationship) {
    case 'self':
    case 'spouse':
      return 'emergency.viewer.parent'
    case 'parent':
      return 'emergency.viewer.grandparent'
    case 'child':
      // An unlinked card with the viewer's own name is their card.
      if (!card.person_id && sameName(card.person_name, viewer.name)) return 'emergency.viewer.you'
      return 'emergency.viewer.sibling'
    default:
      return 'emergency.viewer.other'
  }
}
