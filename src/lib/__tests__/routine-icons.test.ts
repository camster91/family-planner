// Picture routines (#272): the icon catalogue, routine grouping and the chore
// schema rules for icon / routine / routine_order.
import {
  ROUTINE_ICONS,
  ROUTINE_ICON_KEYS,
  groupByRoutine,
  isRoutineIconKey,
  normalizeRoutineName,
  routineIconLabel,
  searchRoutineIcons,
} from '@/lib/routine-icons'
import { createChoreSchema, updateChoreSchema } from '@/lib/validations'

describe('routine icon catalogue', () => {
  it('has about forty unique, stable-format keys with labels', () => {
    expect(ROUTINE_ICONS.length).toBeGreaterThanOrEqual(40)
    expect(new Set(ROUTINE_ICON_KEYS).size).toBe(ROUTINE_ICON_KEYS.length)
    for (const icon of ROUTINE_ICONS) {
      expect(icon.key).toMatch(/^[a-z]+(-[a-z]+)*$/)
      expect(icon.label.trim()).not.toBe('')
    }
  })

  it('covers the routine basics named in the issue', () => {
    for (const key of [
      'brush-teeth', 'get-dressed', 'shoes', 'backpack', 'make-bed', 'bath', 'tidy-toys', 'dishes', 'feed-pet',
      'homework', 'reading', 'water-plants', 'trash', 'laundry', 'set-table', 'breakfast', 'lunchbox', 'coat',
      'wash-hands', 'pyjamas',
    ]) {
      expect(isRoutineIconKey(key)).toBe(true)
    }
  })

  it('looks up labels and rejects unknown keys', () => {
    expect(routineIconLabel('brush-teeth')).toBe('Brush teeth')
    expect(routineIconLabel('nope')).toBeNull()
    expect(routineIconLabel(null)).toBeNull()
    expect(isRoutineIconKey('__proto__')).toBe(false)
    expect(isRoutineIconKey(3)).toBe(false)
  })

  it('searches by label, key and keywords, case-insensitively, every word', () => {
    expect(searchRoutineIcons('').length).toBe(ROUTINE_ICONS.length)
    expect(searchRoutineIcons('TEETH').map((i) => i.key)).toEqual(['brush-teeth'])
    expect(searchRoutineIcons('toothbrush').map((i) => i.key)).toEqual(['brush-teeth'])
    expect(searchRoutineIcons('dog').map((i) => i.key)).toEqual(expect.arrayContaining(['feed-pet', 'walk-dog']))
    expect(searchRoutineIcons('wash hands').map((i) => i.key)).toEqual(['wash-hands'])
    expect(searchRoutineIcons('spaceship')).toEqual([])
  })
})

describe('groupByRoutine', () => {
  const c = (id: string, title: string, routine: string | null, routine_order: number | null = null) => ({
    id,
    title,
    routine,
    routine_order,
  })

  it('orders routines by the day, then by name, and steps by number, then title', () => {
    const { routines, other } = groupByRoutine([
      c('1', 'Pyjamas', 'Bedtime', 1),
      c('2', 'Shoes', 'morning', 3),
      c('3', 'Snack', 'After school', null),
      c('4', 'Brush teeth', 'Morning', 1),
      c('5', 'Get dressed', 'Morning ', 2),
      c('6', 'Violin', 'Zebra club', 1),
      c('7', 'Homework', 'After school', 1),
      c('8', 'Feed cat', null),
      c('9', 'Art', 'Art club', 1),
      c('10', 'Apple', 'After school', null),
    ])
    expect(routines.map((r) => r.name)).toEqual(['morning', 'After school', 'Bedtime', 'Art club', 'Zebra club'])
    expect(routines[0].steps.map((s) => s.title)).toEqual(['Brush teeth', 'Get dressed', 'Shoes'])
    // Numbered steps first, then unnumbered by title.
    expect(routines[1].steps.map((s) => s.title)).toEqual(['Homework', 'Apple', 'Snack'])
    expect(other.map((s) => s.id)).toEqual(['8'])
  })

  it('treats blank routine names as no routine', () => {
    expect(normalizeRoutineName('   ')).toBeNull()
    expect(normalizeRoutineName(' After   school ')).toBe('After school')
    const { routines, other } = groupByRoutine([c('1', 'A', '  '), c('2', 'B', null)])
    expect(routines).toEqual([])
    expect(other).toHaveLength(2)
  })
})

describe('chore schemas: icon, routine, routine_order', () => {
  const base = { title: 'Brush teeth', assigned_to: 'u1', due_date: '2026-01-05' }

  it('accepts a catalogue icon, a routine and a step; all optional', () => {
    const parsed = createChoreSchema.safeParse({ ...base, icon: 'brush-teeth', routine: ' Morning ', routine_order: 1 })
    expect(parsed.success && parsed.data).toMatchObject({ icon: 'brush-teeth', routine: 'Morning', routine_order: 1 })
    const bare = createChoreSchema.safeParse(base)
    expect(bare.success && bare.data.icon).toBeUndefined()
  })

  it('rejects unknown icons, long routine names and out-of-range steps', () => {
    const bad = [
      { icon: 'rocket' },
      { icon: '' },
      { routine: 'x'.repeat(41) },
      { routine_order: 0 },
      { routine_order: 100 },
      { routine_order: 2.5 },
      { routine_order: '2' },
    ]
    for (const extra of bad) {
      expect(createChoreSchema.safeParse({ ...base, ...extra }).success).toBe(false)
      expect(updateChoreSchema.safeParse({ choreId: 'c1', ...extra }).success).toBe(false)
    }
    const msg = createChoreSchema.safeParse({ ...base, icon: 'rocket' })
    expect(!msg.success && msg.error.issues[0].message).toBe('Choose a picture from the list')
  })

  it('accepts 40 characters and null to clear; an empty routine becomes null', () => {
    expect(createChoreSchema.safeParse({ ...base, routine: 'x'.repeat(40) }).success).toBe(true)
    const cleared = updateChoreSchema.safeParse({ choreId: 'c1', icon: null, routine: null, routine_order: null })
    expect(cleared.success && cleared.data).toMatchObject({ icon: null, routine: null, routine_order: null })
    const empty = updateChoreSchema.safeParse({ choreId: 'c1', routine: '  ' })
    expect(empty.success && empty.data.routine).toBeNull()
  })
})
