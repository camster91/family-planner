/** Authored only; no test invocation during the no-QA implementation pass. */
import { parseRewardPaging, encodeRewardCursor, afterRewardCursor } from '../reward-paging'
const row = { id: 'reward-a', created_at: new Date('2026-10-25T12:00:00Z') }
it('binds the exact household/status and uses timestamp/ID position without loading a pivot', () => {
  const cursor = encodeRewardCursor('family-a', 'claimed', row)
  const parsed = parseRewardPaging(new URLSearchParams({ limit: '24', status: 'claimed', cursor }), 'family-a')
  expect(parsed).toMatchObject({ ok: true, paged: true, limit: 24, status: 'claimed' })
  if (!parsed.ok || !parsed.paged || !parsed.cursor) throw new Error('Missing fixture cursor')
  expect(afterRewardCursor(parsed.cursor)).toEqual({ OR: [{ created_at: { lt: row.created_at } }, { created_at: row.created_at, id: { gt: row.id } }] })
  expect(parseRewardPaging(new URLSearchParams({ limit: '24', status: 'claimed', cursor }), 'family-b').ok).toBe(false)
  expect(parseRewardPaging(new URLSearchParams({ limit: '24', status: 'available', cursor }), 'family-a').ok).toBe(false)
})
it.each(['limit=0', 'limit=101', 'limit=2&limit=3', 'limit=2&status=claimed&status=available', 'cursor=abc', 'limit=24&cursor=abc', 'limit=24&status=unknown'])('refuses malformed paging %s', value => {
  expect(parseRewardPaging(new URLSearchParams(value), 'family-a').ok).toBe(false)
})
it('retains the legacy unpaged status contract without limit', () => {
  expect(parseRewardPaging(new URLSearchParams({ status: 'legacy-status' }), 'family-a')).toEqual({ ok: true, paged: false })
})
