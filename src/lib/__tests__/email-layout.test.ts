// Warm Paper email frame (docs/product/BRAND.md): banner at the top from the
// app's own origin, brand colours inline, body passed through unchanged.
import fs from 'fs'
import path from 'path'
import { brandedEmailHtml, emailButton } from '@/lib/email-layout'
import { familyInviteEmail } from '@/lib/mail'

describe('brandedEmailHtml', () => {
  const OLD = process.env.NEXT_PUBLIC_APP_URL
  afterEach(() => {
    if (OLD === undefined) delete process.env.NEXT_PUBLIC_APP_URL
    else process.env.NEXT_PUBLIC_APP_URL = OLD
  })

  it('puts the houses banner first, as an absolute URL with empty alt and width 600', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://family.example.test/'
    const html = brandedEmailHtml('<p>Hello</p>')
    const img = /<img [^>]+>/.exec(html)![0]
    expect(img).toContain('src="https://family.example.test/brand/illustrations/houses-banner-email.png"')
    expect(img).toContain('width="600"')
    expect(img).toContain('alt=""')
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('<p>Hello</p>'))
  })

  it('serves a banner file that exists in public/', () => {
    const file = path.join(process.cwd(), 'public', 'brand', 'illustrations', 'houses-banner-email.png')
    expect(fs.existsSync(file)).toBe(true)
  })

  it('uses the Warm Paper colours inline', () => {
    const html = brandedEmailHtml('<h2>Verify Your Email</h2><p>Hi</p>', 'https://a.test')
    expect(html).toContain('background:#FBF7F0')
    expect(html).toContain('color:#1F2A44')
    expect(html).toMatch(/<h2 style="[^"]*font-family:Georgia/)
  })

  it('renders a navy button and escapes its URL and label', () => {
    const button = emailButton('https://a.test/x?a=1&b="2"', 'Join <family>')
    expect(button).toContain('href="https://a.test/x?a=1&amp;b=&quot;2&quot;"')
    expect(button).toContain('background:#1F2A44')
    expect(button).toContain('color:#FFFDF9')
    expect(button).toContain('Join &lt;family&gt;')
  })

  it('keeps the invite plain-text part unchanged', () => {
    const mail = familyInviteEmail({
      familyName: 'Sample',
      inviterName: 'Alex',
      role: 'child',
      joinUrl: 'https://a.test/join?token=t',
    })
    expect(mail.text).toBe(
      ['Alex invited you to join Sample as a child.', 'Join: https://a.test/join?token=t', 'This invite expires in 48 hours.'].join(
        '\n'
      )
    )
    expect(mail.html).toContain('houses-banner-email.png')
    expect(mail.html).toContain('Join family</a>')
  })
})
