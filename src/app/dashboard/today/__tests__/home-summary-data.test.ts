import { loadHomeSummary } from '../home-summary-data'

const NOW = new Date('2026-01-05T12:00:00.000Z')

function dbWith(rows: unknown[]) {
  return {
    chore: {
      findMany: jest.fn().mockResolvedValue(rows),
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
})
