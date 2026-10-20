import { loadHomeSummary } from '../home-summary-data'

const NOW = new Date('2026-01-05T12:00:00.000Z')

function dbWith(rows: unknown[]) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    chore: {
      findMany: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'u_child', name: 'Casey Child' }]),
    },
  } as any
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
    db.chore.findFirst.mockResolvedValue({ id: 'profile-after-cap' })

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
    expect(db.chore.findFirst).toHaveBeenCalledWith(
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
        select: { id: true },
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
