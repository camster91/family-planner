import { getOpenShoppingItems } from '../shopping-snapshot'

function fakeDb(rows: any[], total: number) {
  return {
    listItem: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(total),
    },
  }
}

describe('getOpenShoppingItems', () => {
  it('scopes to the family, open items and grocery/shopping lists', async () => {
    const db = fakeDb([], 0)
    await getOpenShoppingItems(db as any, 'family-A', 5)

    const expectedWhere = {
      checked: false,
      list: { family_id: 'family-A', type: { in: ['grocery', 'shopping'] } },
    }
    expect(db.listItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, take: 5 })
    )
    expect(db.listItem.count).toHaveBeenCalledWith({ where: expectedWhere })
  })

  it('maps rows to the dashboard shape with the owning list', async () => {
    const db = fakeDb(
      [{ id: 'i1', content: 'Milk', quantity: 2, list: { id: 'l1', name: 'Groceries' } }],
      7
    )
    const snapshot = await getOpenShoppingItems(db as any, 'family-A')
    expect(snapshot).toEqual({
      items: [{ id: 'i1', content: 'Milk', quantity: 2, listId: 'l1', listName: 'Groceries' }],
      total: 7,
    })
  })

  it('returns an empty snapshot when nothing is open', async () => {
    const snapshot = await getOpenShoppingItems(fakeDb([], 0) as any, 'family-A')
    expect(snapshot).toEqual({ items: [], total: 0 })
  })
})
