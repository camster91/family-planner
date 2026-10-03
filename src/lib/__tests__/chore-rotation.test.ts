// Take turns (O-39): who gets the next copy of a rotating series.
//
// The pure rule (wrap-around, skipping members who left, idempotent planning)
// and the series generation against the two-household fake database: a hand
// reassign of one copy never changes the order, a repeated top-up never
// reshuffles copies already made, and removing a member hands their place to
// the person after them. Real Postgres: chore-rotation.integration.test.ts.

jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import {
  applyRotationEditInTx,
  dropMemberFromRotationsInTx,
  isRotating,
  nextRotationMember,
  nextRotationTurn,
  planRotationTurns,
  sameRotation,
} from '@/lib/chore-rotation'
import { expandSeriesInTx } from '@/lib/recurringChores'
import { FAMILY_A, FAMILY_B, db, fakePrisma } from '@/__tests__/helpers/two-household'

const S = 'parent-a'
const A = 'teen-a'
const J = 'child-a'

describe('nextRotationTurn / planRotationTurns', () => {
  it('starts with the first person and wraps around', () => {
    expect(planRotationTurns([S, A, J], null, 5).map((t) => t.assignee)).toEqual([S, A, J, S, A])
    expect(planRotationTurns([S, A, J], null, 5).map((t) => t.index)).toEqual([0, 1, 2, 0, 1])
  })

  it('carries on after the previous place', () => {
    expect(nextRotationTurn([S, A, J], 0)).toEqual({ index: 1, assignee: A })
    expect(nextRotationTurn([S, A, J], 2)).toEqual({ index: 0, assignee: S })
  })

  it('a place past the end of a shorter list still wraps', () => {
    expect(nextRotationTurn([S, A], 5)).toEqual({ index: 0, assignee: S })
  })

  it('skips a member who is no longer in the household', () => {
    const active = (id: string) => id !== A
    expect(nextRotationTurn([S, A, J], 0, active)).toEqual({ index: 2, assignee: J })
    expect(planRotationTurns([S, A, J], null, 4, active).map((t) => t.assignee)).toEqual([S, J, S, J])
  })

  it('nobody left: no assignee, the caller falls back', () => {
    expect(nextRotationTurn([S, A], 0, () => false)).toEqual({ index: 1, assignee: null })
  })

  it('an empty list is not a rotation', () => {
    expect(nextRotationTurn([], null)).toBeNull()
    expect(planRotationTurns([], null, 3)).toEqual([])
  })

  it('is deterministic: the same state plans the same people', () => {
    expect(planRotationTurns([S, A, J], 1, 6)).toEqual(planRotationTurns([S, A, J], 1, 6))
  })
})

describe('helpers', () => {
  it('sameRotation compares order', () => {
    expect(sameRotation([S, A], [S, A])).toBe(true)
    expect(sameRotation([S, A], [A, S])).toBe(false)
    expect(sameRotation(null, [])).toBe(true)
  })

  it('isRotating needs two people', () => {
    expect(isRotating([S])).toBe(false)
    expect(isRotating([S, A])).toBe(true)
    expect(isRotating(null)).toBe(false)
  })

  it('nextRotationMember names who is after a place', () => {
    expect(nextRotationMember([S, A, J], 2)).toBe(S)
    expect(nextRotationMember([S, A, J], null)).toBeNull()
    expect(nextRotationMember([S], 0)).toBeNull()
  })
})

describe('series generation with take turns (fake database)', () => {
  // A Monday. The template is due that day; weekly keeps 4 upcoming.
  const NOW = new Date('2099-01-05T12:00:00Z')
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
  const TEMPLATE = 'dishes-template'

  function addTemplate(rotation: string[], familyId = FAMILY_A) {
    db.rows('chore').push({
      id: TEMPLATE,
      family_id: familyId,
      title: 'Dishes',
      description: null,
      points: 10,
      difficulty: 'easy',
      assigned_to: rotation[0],
      created_by: S,
      due_date: day('2099-01-05'),
      status: 'pending',
      frequency: 'weekly',
      recurrence_id: TEMPLATE,
      is_template: true,
      icon: null,
      routine: null,
      routine_order: null,
      rotation_member_ids: rotation,
      rotation_index: 0,
      created_at: NOW,
    })
  }

  const series = () =>
    db
      .rows('chore')
      .filter((c) => c.recurrence_id === TEMPLATE)
      .sort((a, b) => a.due_date.getTime() - b.due_date.getTime())
  const people = () => series().map((c) => c.assigned_to)

  beforeEach(() => db.reset())

  it('copies go to the next person in order, wrapping around', async () => {
    addTemplate([S, A, J])
    await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW)
    expect(people()).toEqual([S, A, J, S])
    expect(series().map((c) => c.rotation_index)).toEqual([0, 1, 2, 0])
  })

  it('a repeated top-up adds nothing and moves nobody', async () => {
    addTemplate([S, A, J])
    await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW)
    const before = series().map((c) => [c.id, c.assigned_to, c.rotation_index])
    expect(await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW)).toBe(0)
    expect(series().map((c) => [c.id, c.assigned_to, c.rotation_index])).toEqual(before)
  })

  it('reassigning one copy by hand does not change the order', async () => {
    addTemplate([S, A, J])
    await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW)
    // The last copy (S's turn, 2099-01-26) is handed to J by a parent.
    const last = series()[3]
    last.assigned_to = J
    // A week later the window refills: the next copy is A's turn, after S's place.
    const added = await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, new Date('2099-01-12T12:00:00Z'))
    expect(added).toBe(1)
    expect(people()).toEqual([S, A, J, J, A])
    expect(series()[4].rotation_index).toBe(1)
  })

  it('who ticked it does not matter, and a skipped one keeps its person', async () => {
    addTemplate([S, A])
    await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW)
    // A ticks S's chore; the 2099-01-12 one (A's) is never done.
    series()[0].status = 'completed'
    await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, new Date('2099-01-20T12:00:00Z'))
    const rows = series()
    expect(rows[1]).toMatchObject({ assigned_to: A, status: 'pending' })
    expect(people()).toEqual([S, A, S, A, S, A, S])
  })

  it('a member who left the household is skipped', async () => {
    addTemplate([S, A, J])
    db.find('user', A)!.family_id = null
    await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW)
    expect(people()).toEqual([S, J, S, J])
  })

  it('never assigns a member of another household', async () => {
    addTemplate([S, 'child-b'])
    await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW)
    expect(people()).toEqual([S, S, S, S])
  })

  it('a template of another household is not expanded', async () => {
    addTemplate([S, A], FAMILY_B)
    expect(await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW)).toBe(0)
  })

  it('without a rotation copies go to the template assignee, as before', async () => {
    addTemplate([J])
    db.find('chore', TEMPLATE)!.rotation_member_ids = []
    await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW)
    expect(people()).toEqual([J, J, J, J])
    expect(series().slice(1).every((c) => c.rotation_index === null)).toBe(true)
  })

  describe('dropMemberFromRotationsInTx', () => {
    it('the removed member’s turn passes to the person after them', async () => {
      addTemplate([S, A, J])
      await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW) // S A J S
      // Latest copy is S's place (0). Remove A: next is J.
      await dropMemberFromRotationsInTx(fakePrisma, FAMILY_A, A)
      expect(db.find('chore', TEMPLATE)!.rotation_member_ids).toEqual([S, J])
      expect(series().map((c) => c.rotation_index)).toEqual([0, 0, 1, 0])
      await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, new Date('2099-01-12T12:00:00Z'))
      expect(series()[4].assigned_to).toBe(J)
    })

    it('removing the person whose place is latest: the next one is whoever followed them', async () => {
      addTemplate([S, A, J])
      await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW) // S A J S, latest place 0
      await dropMemberFromRotationsInTx(fakePrisma, FAMILY_A, S)
      expect(db.find('chore', TEMPLATE)!.rotation_member_ids).toEqual([A, J])
      await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, new Date('2099-01-12T12:00:00Z'))
      expect(series()[4].assigned_to).toBe(A)
    })

    it('the series itself passes to the next person, so it survives their leaving', async () => {
      addTemplate([S, A, J]) // the template is assigned to S, the first person
      await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW)
      await dropMemberFromRotationsInTx(fakePrisma, FAMILY_A, S)
      expect(db.find('chore', TEMPLATE)!.assigned_to).toBe(A)
      // Someone else's template stays theirs.
      await dropMemberFromRotationsInTx(fakePrisma, FAMILY_A, J)
      expect(db.find('chore', TEMPLATE)!.assigned_to).toBe(A)
    })

    it('down to one person: every new copy goes to them', async () => {
      addTemplate([S, A])
      await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW)
      await dropMemberFromRotationsInTx(fakePrisma, FAMILY_A, S)
      expect(db.find('chore', TEMPLATE)!.rotation_member_ids).toEqual([A])
      await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, new Date('2099-01-20T12:00:00Z'))
      expect(series().slice(4).map((c) => c.assigned_to)).toEqual([A, A, A])
    })

    it('down to nobody: the rotation clears and copies follow the template assignee', async () => {
      addTemplate([J])
      await dropMemberFromRotationsInTx(fakePrisma, FAMILY_A, J)
      expect(db.find('chore', TEMPLATE)!.rotation_member_ids).toEqual([])
      expect(series().every((c) => c.rotation_index === null)).toBe(true)
    })

    it('only touches the given household', async () => {
      addTemplate([S, 'parent-b'], FAMILY_B)
      expect(await dropMemberFromRotationsInTx(fakePrisma, FAMILY_A, S)).toBe(0)
      expect(db.find('chore', TEMPLATE)!.rotation_member_ids).toEqual([S, 'parent-b'])
    })
  })

  describe('applyRotationEditInTx', () => {
    it('re-plans copies due after today that nobody started, from the first person', async () => {
      addTemplate([S, A])
      await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW) // S A S A
      series()[2].status = 'in_progress' // someone started the 2099-01-19 one
      const changed = await applyRotationEditInTx(fakePrisma, TEMPLATE, FAMILY_A, [J, A, S], NOW)
      expect(changed).toBe(true)
      // Today's (template) keeps its person; the started one keeps its person
      // and takes no place, so nobody's turn is used up: J, then A.
      expect(people()).toEqual([S, J, S, A])
      expect(series().map((c) => c.rotation_index)).toEqual([null, 0, null, 1])
      // The next copy carries on after A.
      await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, new Date('2099-01-12T12:00:00Z'))
      expect(series()[4].assigned_to).toBe(S)
    })

    it('a copy given to someone by hand keeps that person when the order changes', async () => {
      addTemplate([S, A])
      await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW) // S A S A
      series()[2].assigned_to = J // a parent gave the 2099-01-19 one to J
      await applyRotationEditInTx(fakePrisma, TEMPLATE, FAMILY_A, [A, S], NOW)
      // J keeps it and takes no place; the other not-started copies go A, S.
      expect(people()).toEqual([S, A, J, S])
      expect(series().map((c) => c.rotation_index)).toEqual([null, 0, null, 1])
    })

    it('an unchanged list is a no-op', async () => {
      addTemplate([S, A])
      await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW)
      const before = JSON.stringify(series())
      expect(await applyRotationEditInTx(fakePrisma, TEMPLATE, FAMILY_A, [S, A], NOW)).toBe(false)
      expect(JSON.stringify(series())).toBe(before)
    })

    it('clearing keeps everyone’s chores as they are', async () => {
      addTemplate([S, A])
      await expandSeriesInTx(fakePrisma, TEMPLATE, FAMILY_A, NOW)
      await applyRotationEditInTx(fakePrisma, TEMPLATE, FAMILY_A, [], NOW)
      expect(people()).toEqual([S, A, S, A])
      expect(db.find('chore', TEMPLATE)!.rotation_member_ids).toEqual([])
    })

    it('another household’s template is left alone', async () => {
      addTemplate([S, A], FAMILY_B)
      expect(await applyRotationEditInTx(fakePrisma, TEMPLATE, FAMILY_A, [J, S], NOW)).toBe(false)
    })
  })
})
