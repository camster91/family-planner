import { createWishlistItemSchema, updateWishlistItemSchema } from '@/lib/validations'

// A wish link is rendered as <a href>: only http(s) may be stored.
describe('wishlist link validation', () => {
  it.each(['https://shop.example/item', 'http://shop.example/item', '', null, undefined])('accepts %p', (link) => {
    expect(createWishlistItemSchema.safeParse({ title: 'Lego', link }).success).toBe(true)
    expect(updateWishlistItemSchema.safeParse({ link }).success).toBe(true)
  })

  it.each(['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'vbscript:x', 'shop.example/item', 'ftp://x.example/f'])(
    'refuses %p',
    (link) => {
      expect(createWishlistItemSchema.safeParse({ title: 'Lego', link }).success).toBe(false)
      expect(updateWishlistItemSchema.safeParse({ link }).success).toBe(false)
    }
  )
})
