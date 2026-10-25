/** Source-only message read contract cases; execution deferred. */
import { parseMessagePaging, encodeMessageCursor, afterMessageCursor } from '../message-paging'
const row = { id: 'message-b', created_at: new Date('2026-10-25T12:00:00Z') }
it('binds message cursors to the household and retains a deleted pivot position', () => {
  const cursor = encodeMessageCursor('family-a', row)
  const params = new URLSearchParams({ paging: 'keyset-v1', cursor, limit: '50' })
  const page = parseMessagePaging(params, 'family-a')
  expect(page).toEqual({ ok: true, limit: 50, cursor: { createdAt: row.created_at, id: row.id } })
  if (!page.ok || !page.cursor) throw new Error('Missing fixture position')
  expect(afterMessageCursor(page.cursor)).toEqual({ OR: [{ created_at: { lt: row.created_at } }, { created_at: row.created_at, id: { gt: row.id } }] })
  expect(parseMessagePaging(params, 'family-b').ok).toBe(false)
})
it.each(['paging=unknown', 'paging=keyset-v1&paging=keyset-v1', 'paging=keyset-v1&limit=0', 'paging=keyset-v1&limit=101', 'paging=keyset-v1&limit=2&limit=3', 'paging=keyset-v1&cursor=abc', 'paging=keyset-v1&cursor=', 'paging=keyset-v1&cursor=a&cursor=b'])('refuses invalid message paging %s', value => {
  expect(parseMessagePaging(new URLSearchParams(value), 'family-a').ok).toBe(false)
})
it('defaults to the existing50-message page size in explicit keyset mode', () => {
  expect(parseMessagePaging(new URLSearchParams({ paging: 'keyset-v1' }), 'family-a')).toEqual({ ok: true, limit: 50, cursor: null })
})
