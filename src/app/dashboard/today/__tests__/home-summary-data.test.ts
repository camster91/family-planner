import { loadHomeSummary } from '../home-summary-data'

const NOW = new Date('2026-01-05T12:00:00.000Z')

function dbWith(rows: unknown[]) {
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    chore: {
      findMany: jest.fn().mockResolvedValue(rows),
      profileProbe: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'u_child', name: 'Casey Child' }]),
    },
  }
  // Synthetic query adapter: provide selected creation times and keep probe
  // fixtures separate from the capped chore payload. No production fallback.
  const chores = db.chore as any
  const readChores = chores.findMany.getMockImplementation()
  chores.findMany.mockImplementation(async (args: any) => {
    const where = args.where.AND?.[0] ?? args.where
    const values = where.assigned_to === null
      ? await chores.profileProbe(args)
      : await readChores(args)
    const rows = (Array.isArray(values) ? values : values ? [values] : []).map((row: any) => ({
      ...row, due_date: row.due_date ?? NOW, created_at: row.created_at ?? NOW,
    }))
    rows.sort((a: any, b: any) => a.due_date.getTime() - b.due_date.getTime() ||
      a.created_at.getTime() - b.created_at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const after = args.where.AND?.[1]?.OR?.[2]
    return rows.filter((row: any) => !after || row.due_date > after.due_date ||
      (row.due_date.getTime() === after.due_date.getTime() &&
        (row.created_at > after.created_at ||
          (row.created_at.getTime() === after.created_at.getTime() && row.id > after.id.gt))))
      .slice(0, args.take)
  })
  return db as any
}

describe('loadHomeSummary subject compatibility', () => {
  it('keeps the personal summary account-only while marking the protocol used', async () => {
    const data = await loadHomeSummary(
      dbWith([
        {
          id: 'account',
          title: 'Dishes',
          due_date: NOW,
          status: 'pending',
          assigned_to: 'u_child',
          assigned_member_id: null,
        },
      ]),
      { familyId: 'fam_a', role: 'parent', memberProtocol: 2, now: NOW },
    )
    expect(data.memberProtocol).toBe(2)
    expect(data.protocolError).toBeUndefined()
    expect(data.chores.map((chore) => chore.assigneeId)).toEqual(['u_child'])
  })

  it('returns the stable refusal marker when a protocol-1 summary would hide a profile chore', async () => {
    const data = await loadHomeSummary(
      dbWith([
        {
          id: 'profile',
          title: 'Toys',
          due_date: NOW,
          status: 'pending',
          assigned_to: null,
          assigned_member_id: 'member_only',
          member_subject_erased: false,
          assigneeMember: {
            id: 'member_only',
            family_id: 'fam_a',
            role: 'child',
            age: 3,
            archived_at: null,
            erasure_user_id: null,
            legacy_mapping: null,
            account_link: null,
          },
        },
      ]),
      { familyId: 'fam_a', role: 'parent', memberProtocol: 1, now: NOW },
    )
    expect(data.chores).toEqual([])
    expect(data.protocolError).toEqual({
      code: 'MEMBER_PROTOCOL_UNAVAILABLE',
      recovery: 'refresh-and-retain-pending',
      requiredProtocol: 2,
      receivedProtocol: 1,
    })
  })

  it('probes past the capped rows before returning a protocol-1 summary', async () => {
    const db = dbWith([
      {
        id: 'account-only-capped-row',
        title: 'Dishes',
        due_date: NOW,
        status: 'pending',
        assigned_to: 'u_child',
        assigned_member_id: null,
      },
    ])
    db.chore.profileProbe.mockResolvedValue({ id: 'profile-after-cap' })

    const data = await loadHomeSummary(db, {
      familyId: 'fam_a',
      role: 'parent',
      memberProtocol: 1,
      now: NOW,
    })

    expect(data.chores).toEqual([
      expect.objectContaining({ id: 'account-only-capped-row' }),
    ])
    expect(data.protocolError?.code).toBe('MEMBER_PROTOCOL_UNAVAILABLE')
    expect(db.chore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          family_id: 'fam_a',
          assigned_to: null,
          assigned_member_id: { not: null },
          member_subject_erased: false,
          assigneeMember: {
            is: expect.objectContaining({
              family_id: 'fam_a',
              archived_at: null,
              erasure_user_id: null,
              legacy_mapping: { is: null },
              account_link: { is: null },
            }),
          },
        }),
        select: { id: true, due_date: true, created_at: true },
      }),
    )
  })

  it('does not refuse for a mapped profile row that is not an active profile subject', async () => {
    const db = dbWith([
      {
        id: 'mapped-profile',
        title: 'Mapped task',
        due_date: NOW,
        status: 'pending',
        assigned_to: null,
        assigned_member_id: 'member_mapped',
        member_subject_erased: false,
        assigneeMember: {
          id: 'member_mapped',
          family_id: 'fam_a',
          role: 'child',
          age: 8,
          archived_at: null,
          erasure_user_id: null,
          legacy_mapping: { user_id: 'u_child' },
          account_link: null,
        },
      },
    ])

    const data = await loadHomeSummary(db, {
      familyId: 'fam_a',
      role: 'parent',
      memberProtocol: 1,
      now: NOW,
    })

    expect(data.chores).toEqual([])
    expect(data.protocolError).toBeUndefined()
  })
})
