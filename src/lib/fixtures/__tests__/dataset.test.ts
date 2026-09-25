import {
  buildFixtureDataset,
  DEFAULT_FIXTURE_ANCHOR,
  FIXTURE_CROSS_FAMILY,
  FIXTURE_EMAILS,
  FIXTURE_ID_PREFIX,
  FIXTURE_IDS,
  FIXTURE_PASSWORD,
  fixtureIdsByTable,
  resolveFixtureAnchor,
} from '..'

const ds = buildFixtureDataset()

function allIds() {
  return Object.values(fixtureIdsByTable(ds)).flat()
}

describe('fixture dataset', () => {
  it('is deterministic: two builds are deep-equal and serialise identically', () => {
    const again = buildFixtureDataset()
    expect(again).toEqual(ds)
    expect(JSON.stringify(again)).toBe(JSON.stringify(ds))
    expect(buildFixtureDataset(new Date(DEFAULT_FIXTURE_ANCHOR))).toEqual(ds)
  })

  it('does not depend on the wall clock', () => {
    jest.useFakeTimers().setSystemTime(new Date('2031-07-01T00:00:00Z'))
    try {
      expect(buildFixtureDataset()).toEqual(ds)
    } finally {
      jest.useRealTimers()
    }
  })

  it('derives every timestamp from the anchor', () => {
    const shifted = buildFixtureDataset('2026-01-12T12:00:00Z') // +7 days
    const week = 7 * 24 * 60 * 60 * 1000
    expect(shifted.events.map((e) => (e.start_time as Date).getTime() - week)).toEqual(
      ds.events.map((e) => (e.start_time as Date).getTime())
    )
    expect(shifted.chores.map((c) => (c.due_date as Date).getTime() - week)).toEqual(
      ds.chores.map((c) => (c.due_date as Date).getTime())
    )
  })

  it('rejects an invalid anchor', () => {
    expect(() => resolveFixtureAnchor('not-a-date')).toThrow(/FIXTURES_ANCHOR_DATE/)
    expect(resolveFixtureAnchor(undefined).toISOString()).toBe(DEFAULT_FIXTURE_ANCHOR)
    expect(resolveFixtureAnchor('  ').toISOString()).toBe(DEFAULT_FIXTURE_ANCHOR)
  })

  it('uses unique, fx_-prefixed ids everywhere', () => {
    const ids = allIds()
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.startsWith(FIXTURE_ID_PREFIX)).toBe(true)
    const invites = ds.families.map((f) => f.invite_code)
    expect(new Set(invites).size).toBe(invites.length)
  })

  it('exported id/email constants all exist in the dataset', () => {
    const ids = new Set(allIds())
    for (const group of Object.values(FIXTURE_IDS)) {
      for (const id of Object.values(group)) expect(ids.has(id)).toBe(true)
    }
    const emails = new Set(ds.users.map((u) => u.email))
    for (const group of Object.values(FIXTURE_EMAILS)) {
      for (const email of Object.values(group)) expect(emails.has(email)).toBe(true)
    }
  })

  it('uses only synthetic identities', () => {
    for (const u of ds.users) expect(u.email).toMatch(/@example\.(test|com)$/)
    expect(new Set(ds.users.map((u) => u.email)).size).toBe(ds.users.length)
    expect(FIXTURE_PASSWORD).toMatch(/Fixture/)
  })

  it('gives families A and B a parent, a teen and a child', () => {
    for (const fam of [FIXTURE_IDS.familyA.family, FIXTURE_IDS.familyB.family]) {
      const members = ds.users.filter((u) => u.family_id === fam)
      for (const role of ['parent', 'teen', 'child'] as const) {
        expect(members.some((m) => m.role === role)).toBe(true)
      }
      for (const m of members) {
        if (m.role === 'teen') expect(m.age).toBeGreaterThanOrEqual(13)
        if (m.role === 'child') expect(m.age).toBeLessThan(13)
      }
    }
  })

  it('keeps households disjoint: every reference stays inside its own family', () => {
    const userFamily = new Map(ds.users.map((u) => [u.id, u.family_id]))
    const listFamily = new Map(ds.lists.map((l) => [l.id, l.family_id]))
    const same = (fam: string, userId: string | null | undefined) => {
      if (userId == null) return
      expect(userFamily.get(userId)).toBe(fam)
    }
    for (const e of ds.events) same(e.family_id, e.created_by)
    for (const c of ds.chores) {
      same(c.family_id, c.assigned_to)
      same(c.family_id, c.created_by)
    }
    for (const r of ds.rewards) {
      same(r.family_id, r.created_by)
      same(r.family_id, r.claimed_by)
      same(r.family_id, r.approved_by)
    }
    for (const l of ds.lists) same(l.family_id, l.created_by)
    for (const i of ds.listItems) {
      const fam = listFamily.get(i.list_id)
      expect(fam).toBeDefined()
      same(fam!, i.added_by)
      same(fam!, i.checked_by)
    }
  })

  it('cross-family constants point at the other household', () => {
    const { aToB, bToA } = FIXTURE_CROSS_FAMILY
    expect(aToB.actor.family).toBe(FIXTURE_IDS.familyA.family)
    expect(aToB.foreign.family).toBe(FIXTURE_IDS.familyB.family)
    expect(bToA.foreign.family).toBe(FIXTURE_IDS.familyA.family)
    const famOf = (id: string) =>
      ds.events.find((e) => e.id === id)?.family_id ??
      ds.chores.find((c) => c.id === id)?.family_id ??
      ds.rewards.find((r) => r.id === id)?.family_id ??
      ds.lists.find((l) => l.id === id)?.family_id
    for (const key of ['event', 'chore', 'reward', 'list'] as const) {
      expect(famOf(aToB.foreign[key])).toBe(FIXTURE_IDS.familyB.family)
      expect(famOf(bToA.foreign[key])).toBe(FIXTURE_IDS.familyA.family)
    }
  })

  it('has one well-formed recurring chore series', () => {
    const tplId = FIXTURE_IDS.familyA.recurringChoreTemplate
    const tpl = ds.chores.find((c) => c.id === tplId)!
    expect(tpl).toMatchObject({ is_template: true, recurrence_id: tplId, frequency: 'weekly' })
    const occ = ds.chores.filter((c) => c.recurrence_id === tplId && c.id !== tplId)
    expect(occ.length).toBeGreaterThanOrEqual(2)
    for (const o of occ) expect(o).toMatchObject({ is_template: false, frequency: 'once' })
    const keys = ds.chores.filter((c) => c.recurrence_id).map((c) => `${c.recurrence_id}|${(c.due_date as Date).toISOString()}`)
    expect(new Set(keys).size).toBe(keys.length) // @@unique([recurrence_id, due_date])
  })

  it('covers busy, sparse, empty and long-text scenarios', () => {
    const count = (fam: string) =>
      ds.events.filter((e) => e.family_id === fam).length + ds.chores.filter((c) => c.family_id === fam).length
    expect(count(FIXTURE_IDS.familyA.family)).toBeGreaterThan(20)
    expect(count(FIXTURE_IDS.familyB.family)).toBeLessThanOrEqual(3)
    expect(count(FIXTURE_IDS.familyEmpty.family)).toBe(0)
    expect(ds.users.some((u) => u.name.length > 40)).toBe(true)
    expect(ds.events.some((e) => e.title.length > 80)).toBe(true)
    expect(ds.chores.some((c) => c.title.length > 80)).toBe(true)
    expect(ds.listItems.some((i) => i.content.length > 80)).toBe(true)
    expect(new Set(ds.chores.map((c) => c.status))).toEqual(
      new Set(['pending', 'in_progress', 'completed', 'verified', 'overdue'])
    )
  })

  it('seeds no grocery/meal lists (deferred to #149)', () => {
    for (const l of ds.lists) expect(l.type).toBe('todo')
  })
})
