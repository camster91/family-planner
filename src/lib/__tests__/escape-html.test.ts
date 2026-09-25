import { escapeHtml } from '@/lib/escape-html'

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;'
    )
  })

  it('neutralises attribute breakout', () => {
    expect(escapeHtml('" onmouseover="evil()')).toBe('&quot; onmouseover=&quot;evil()')
  })

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('Jane Doe')).toBe('Jane Doe')
    expect(escapeHtml('https://x.test/a?token=abc123')).toBe('https://x.test/a?token=abc123')
  })

  it('coerces null/undefined to an empty string', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})
