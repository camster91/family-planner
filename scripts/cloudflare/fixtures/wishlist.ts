import {
  createD1Wishlist,
  deleteD1Wishlist,
  readD1WishlistItem,
  readD1WishlistScoped,
  updateD1Wishlist,
  updateD1WishlistStatus,
} from '../../../src/lib/cloudflare/wishlist'
import type { D1Store } from '../../../src/lib/cloudflare/database'
import { parseWishlistPaging } from '../../../src/lib/wishlist-paging'

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label)
}

const parent = { userId: 'wishlist-parent', familyId: 'wishlist-family-a', role: 'parent', generation: 0 } as const
const child = { userId: 'wishlist-child', familyId: 'wishlist-family-a', role: 'child', generation: 0 } as const
const foreign = { userId: 'wishlist-foreign', familyId: 'wishlist-family-b', role: 'parent', generation: 0 } as const
const features = JSON.stringify({ wishlist: true })

/** Disposable native coverage for wishlist ownership, status and receipt behavior. */
export async function testWishlist(db: D1Store) {
  const now = Date.parse('2026-10-28T16:00:00.000Z')
  await db.batch([
    db.prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES ('wishlist-family-a','Wishlist A','wishlist-code-a',?1),('wishlist-family-b','Wishlist B','wishlist-code-b',?1)`).bind(features),
    db.prepare(`INSERT INTO "User"(id,email,name,family_id,role,token_version) VALUES
      ('wishlist-parent','wishlist-parent@example.test','Wishlist Parent','wishlist-family-a','parent',0),
      ('wishlist-child','wishlist-child@example.test','Wishlist Child','wishlist-family-a','child',0),
      ('wishlist-foreign','wishlist-foreign@example.test','Other Parent','wishlist-family-b','parent',0)`),
    db.prepare(`INSERT INTO "WishlistItem"(id,family_id,requested_by,title,link,description,approx_price,status,created_at,updated_at) VALUES ('wishlist-existing','wishlist-family-a','wishlist-child','Board game','https://example.test/game','For family night',29.99,'idle',?1,?1)`).bind(now),
  ])

  const listed = await readD1WishlistScoped(parent, { requesterId: null }, { ok: true, paged: false }, db)
  check(listed.status === 200 && (listed.body as any).items.length === 1, 'wishlist read stays in household')
  const mine = await readD1WishlistScoped(child, { requesterId: child.userId }, { ok: true, paged: true, limit: 10, cursor: null }, db)
  check(mine.status === 200 && (mine.body as any).items[0].requested_by === child.userId, 'mine filter')
  await db.prepare(`INSERT INTO "WishlistItem" (id,family_id,requested_by,title,status,created_at,updated_at) VALUES ('wishlist-page-old',?1,?2,'Older wish','idle',?3,?3)`).bind(parent.familyId, child.userId, now - 1000).run()
  const wishlistPage = await readD1WishlistScoped(parent, { requesterId: null }, { ok: true, paged: true, limit: 1, cursor: null }, db)
  const wishlistCursor = (wishlistPage.body as any).nextCursor
  check(wishlistPage.status === 200 && typeof wishlistCursor === 'string', 'wishlist cursor encodes native page')
  const parsedWishlistPaging = parseWishlistPaging(new URLSearchParams({ limit: '1', cursor: wishlistCursor }), { familyId: parent.familyId, requesterId: null })
  check(parsedWishlistPaging.ok && parsedWishlistPaging.paged, 'wishlist cursor parses')
  const nextWishlistPage = await readD1WishlistScoped(parent, { requesterId: null }, parsedWishlistPaging, db)
  check(nextWishlistPage.status === 200 && (nextWishlistPage.body as any).items[0].id === 'wishlist-page-old' && (nextWishlistPage.body as any).nextCursor === null, 'wishlist cursor advances over native epoch rows')
  check((await readD1WishlistItem(foreign, 'wishlist-existing', db)).status === 404, 'foreign item hidden')

  const input = { title: 'New headphones', link: 'https://example.test/headphones', description: 'Quiet pair', approx_price: 80 }
  const created = await createD1Wishlist(child, input, 'wishlist-create-key', db)
  check(created.status === 201 && (created.body as any).item.requested_by === child.userId, 'wishlist create')
  const replay = await createD1Wishlist(child, input, 'wishlist-create-key', db)
  check(replay.replayed && JSON.stringify(replay.body) === JSON.stringify(created.body), 'wishlist create replay')
  const id = (created.body as any).item.id as string
  check((await updateD1Wishlist(child, id, { title: 'New headphones updated' }, 'wishlist-update-key', db)).status === 200, 'requester update')
  check((await updateD1Wishlist(foreign, id, { title: 'No' }, null, db)).status === 404, 'foreign update hidden')
  check((await updateD1WishlistStatus(child, id, { status: 'received' }, null, db)).status === 403, 'child status denied')
  const status = await updateD1WishlistStatus(parent, id, { status: 'denied', denied_reason: 'Not needed' }, 'wishlist-status-key', db)
  check(status.status === 200 && (status.body as any).item.status_changer.id === parent.userId, 'parent status update')
  const statusReplay = await updateD1WishlistStatus(parent, id, { status: 'denied', denied_reason: 'Not needed' }, 'wishlist-status-key', db)
  check(statusReplay.replayed, 'status replay')
  check((await deleteD1Wishlist(child, id, 'wishlist-delete-key', db)).status === 200, 'requester delete')
  check((await deleteD1Wishlist(child, id, 'wishlist-delete-key', db)).replayed, 'delete replay after removal')
  check((await readD1WishlistItem(parent, id, db)).status === 404, 'deleted item is not readable')
  return { read: true, mine: true, create: true, receipts: true, ownership: true, status: true, isolation: true }
}
