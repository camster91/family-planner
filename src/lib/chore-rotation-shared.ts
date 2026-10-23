/** Browser-safe rotation constants and deterministic rules. No identity, DB or server imports. */
export const ROTATION_MIN = 2
export const ROTATION_MAX = 8

export type RotationTurn = {
  /** Place in the rotation list. */
  index: number
  /** Member whose turn it is, or null when nobody in the list is still in the household. */
  assignee: string | null
}

/**
 * The turn after `previousIndex` (null: the rotation starts at the first
 * person). `isActive` says whether a member is still in the household; a
 * member who is not is skipped. Returns null for an empty rotation.
 */
export function nextRotationTurn(
  rotation: readonly string[],
  previousIndex: number | null | undefined,
  isActive: (memberId: string) => boolean = () => true
): RotationTurn | null {
  const n = rotation.length
  if (n === 0) return null
  const start = previousIndex == null || previousIndex < 0 ? 0 : (previousIndex + 1) % n
  for (let k = 0; k < n; k++) {
    const index = (start + k) % n
    if (isActive(rotation[index])) return { index, assignee: rotation[index] }
  }
  return { index: start, assignee: null }
}

/** `count` turns in a row after `previousIndex`. */
export function planRotationTurns(
  rotation: readonly string[],
  previousIndex: number | null | undefined,
  count: number,
  isActive?: (memberId: string) => boolean
): RotationTurn[] {
  const turns: RotationTurn[] = []
  let prev = previousIndex ?? null
  for (let i = 0; i < count; i++) {
    const turn = nextRotationTurn(rotation, prev, isActive)
    if (!turn) break
    turns.push(turn)
    prev = turn.index
  }
  return turns
}

/** Same members in the same order. */
export function sameRotation(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  const x = a ?? []
  const y = b ?? []
  return x.length === y.length && x.every((id, i) => id === y[i])
}

/** Whether a stored list means "takes turns" in the forms and lists (two or more people). */
export function isRotating(rotation: readonly string[] | null | undefined): rotation is string[] {
  return Array.isArray(rotation) && rotation.length >= ROTATION_MIN
}

/**
 * Who is up after the occurrence at `index` (for "Takes turns · next: Alex").
 * Null when the row has no place or the list is not a rotation.
 */
export function nextRotationMember(rotation: readonly string[] | null | undefined, index: number | null | undefined): string | null {
  if (!isRotating(rotation) || index == null) return null
  return nextRotationTurn(rotation, index)?.assignee ?? null
}

