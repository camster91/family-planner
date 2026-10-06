/**
 * Warm Paper contrast gate (docs/product/BRAND.md).
 *
 * Reads the light (:root) and dark (.dark) token blocks from
 * src/app/globals.css and checks every text/background and control pair the
 * components use against WCAG 2.1 AA: 4.5:1 for text, 3:1 for icons, focus
 * rings and other non-text UI. Translucent tokens (tints, fills) are blended
 * over the surface they sit on before measuring. Run with
 * `BRAND_CONTRAST_TABLE=1 npx jest src/__tests__/brand-contrast` to print the
 * full table used in BRAND.md.
 */
import fs from 'fs'
import path from 'path'

type Rgba = { r: number; g: number; b: number; a: number }

const CSS = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8')

function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`  ${selector} {`)
  if (start < 0) throw new Error(`no ${selector} block in globals.css`)
  const end = CSS.indexOf('\n  }', start)
  const body = CSS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const ROOT = block(':root')
const DARK = { ...ROOT, ...block('.dark') }

function parse(value: string, tokens: Record<string, string>, depth = 0): Rgba {
  if (depth > 5) throw new Error(`var() loop at ${value}`)
  const v = value.trim()
  const ref = /^var\((--[\w-]+)\)$/.exec(v)
  if (ref) {
    const next = tokens[ref[1]]
    if (!next) throw new Error(`unknown token ${ref[1]}`)
    return parse(next, tokens, depth + 1)
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(v)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(v)
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((s) => s.trim())
    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) }
  }
  throw new Error(`cannot parse colour ${v}`)
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  }
}

function luminance({ r, g, b }: Rgba): number {
  const c = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)
}

function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** A background: one token, or a translucent token laid over a surface. */
type Bg = string | string[]
type Pair = { fg: string; bg: Bg; min: number; use: string }

const TEXT = 4.5
const UI = 3

const SURFACES = ['--surface-grouped', '--surface-elevated']

const pairs: Pair[] = [
  ...['--label-primary', '--label-secondary', '--label-tertiary'].flatMap((fg) => [
    ...SURFACES.map((bg) => ({ fg, bg, min: TEXT, use: 'text' })),
    { fg, bg: ['--surface-fill', '--surface-elevated'] as Bg, min: TEXT, use: 'text on fills/inputs' },
  ]),
  ...SURFACES.map((bg) => ({ fg: '--accent-text', bg, min: TEXT, use: 'links, active tab' })),
  { fg: '--accent-text', bg: ['--accent-tint', '--surface-elevated'], min: TEXT, use: 'tinted button' },
  { fg: '--accent-text', bg: ['--accent-tint', '--surface-grouped'], min: TEXT, use: 'tinted button on page' },
  { fg: '--accent-text', bg: ['--accent-tint-strong', '--surface-elevated'], min: TEXT, use: 'tinted button hover' },
  { fg: '--accent-text', bg: ['--accent-tint-strong', '--surface-grouped'], min: TEXT, use: 'tinted button hover on page' },
  // A tinted button must not sit on a --surface-fill panel: terracotta on
  // tint over fill is 3.8-4.2:1. Panels holding one use a border instead.
  { fg: '--label-secondary', bg: ['--surface-fill', '--surface-grouped'], min: TEXT, use: 'text on fills on page' },
  ...['--accent-fill', '--accent-fill-hover', '--accent-fill-pressed'].map((bg) => ({
    fg: '--on-accent',
    bg,
    min: TEXT,
    use: 'filled button',
  })),
  { fg: '#FFFFFF', bg: '--accent-fill', min: TEXT, use: 'white icon/text on accent' },
  { fg: '--on-accent', bg: '--danger-fill', min: TEXT, use: 'destructive button' },
  { fg: '--on-accent', bg: '--danger-fill-pressed', min: TEXT, use: 'destructive pressed' },
  ...SURFACES.map((bg) => ({ fg: '--danger-text', bg, min: TEXT, use: 'error text' })),
  { fg: '--danger-text', bg: ['--danger-tint', '--surface-elevated'], min: TEXT, use: 'error banner' },
  { fg: '--danger-text', bg: ['--danger-tint', '--surface-grouped'], min: TEXT, use: 'error banner on page' },
  ...SURFACES.map((bg) => ({ fg: '--warning-text', bg, min: TEXT, use: 'warning text' })),
  { fg: '--warning-text', bg: ['--warning-tint', '--surface-elevated'], min: TEXT, use: 'warning banner' },
  { fg: '--on-warning', bg: '--warning', min: TEXT, use: 'text on mustard fill' },
  ...SURFACES.map((bg) => ({ fg: '--success-text', bg, min: TEXT, use: 'success text' })),
  ...SURFACES.map((bg) => ({ fg: '--success', bg, min: UI, use: 'sage check fill' })),
  { fg: '--success-text', bg: ['--success-tint', '--surface-elevated'], min: TEXT, use: 'success banner' },
  { fg: '--label-primary', bg: ['--success-tint', '--surface-grouped'], min: TEXT, use: 'success banner on page' },
  { fg: '#FFFFFF', bg: '--success', min: UI, use: 'check mark on sage' },
  ...[
    '--tint-chore',
    '--tint-calendar',
    '--tint-lists',
    '--tint-budget',
    '--tint-messages',
    '--tint-family',
    '--tint-rewards',
    '--tint-projects',
    '--tint-meals',
  ].map((bg) => ({ fg: '#FFFFFF', bg, min: TEXT, use: 'white on glyph/avatar' })),
  ...['--tint-lists-text', '--tint-rewards-text'].flatMap((fg) =>
    SURFACES.map((bg) => ({ fg, bg, min: TEXT, use: 'tint as text' }))
  ),
  ...SURFACES.map((bg) => ({ fg: '--focus-ring', bg, min: UI, use: 'focus ring' })),
  ...SURFACES.map((bg) => ({ fg: '--control-border', bg, min: UI, use: 'input boundary' })),
  { fg: '--accent-fill', bg: '--surface-grouped', min: UI, use: 'filled button edge' },
]

function measure(tokens: Record<string, string>, p: Pair): number {
  const colour = (t: string) => (t.startsWith('#') ? parse(t, tokens) : parse(`var(${t})`, tokens))
  // Layers top first; the last one must be opaque.
  const bg = Array.isArray(p.bg) ? p.bg.map(colour).reduceRight((under, layer) => over(layer, under)) : colour(p.bg)
  return ratio(over(colour(p.fg), bg), bg)
}

const label = (bg: Bg) => (Array.isArray(bg) ? `${bg[0]} over ${bg[1]}` : bg)

describe('Warm Paper token contrast (WCAG 2.1 AA)', () => {
  for (const [mode, tokens] of [
    ['light', ROOT],
    ['dark', DARK],
  ] as const) {
    describe(mode, () => {
      test.each(pairs.map((p) => [p.fg, label(p.bg), p.min, p] as const))(
        '%s on %s >= %s:1',
        (_fg, _bg, min, p) => {
          expect(Number(measure(tokens, p).toFixed(2))).toBeGreaterThanOrEqual(min)
        }
      )
    })
  }

  test('Herewoven anchors preserve cream paper and introduce aubergine ink in both themes', () => {
      expect(ROOT['--surface-grouped']).toBe('#FBF7F0')
      expect(ROOT['--label-primary']).toBe('#322C43')
      expect(ROOT['--accent-fill']).toBe('#322C43')
      expect(DARK['--surface-grouped']).toBe('#171420')
      expect(DARK['--surface-elevated']).toBe('#231E2E')
    })

  if (process.env.BRAND_CONTRAST_TABLE === '1') {
    test('print table', () => {
      const rows = pairs.map((p) => {
        const l = measure(ROOT, p).toFixed(2)
        const d = measure(DARK, p).toFixed(2)
        return `| ${p.fg} | ${label(p.bg)} | ${p.use} | ${l} | ${d} | ${p.min} |`
      })
      console.log(['| Foreground | Background | Use | Light | Dark | Min |', '|---|---|---|---|---|---|', ...rows].join('\n'))
    })
  }
})

describe('dark chrome', () => {
  // The phone tab bar sits on the same aubergine as the glass surfaces, not the
  // old navy (#354 review).
  it('gives the dark tab bar the same colour as dark glass', () => {
    const rgb = (selector: string) => {
      const m = new RegExp(`\\${selector} \\{ background: rgba\\((\\d+), (\\d+), (\\d+),`).exec(CSS)
      if (!m) throw new Error(`no ${selector} background in globals.css`)
      return m.slice(1, 4).join(',')
    }
    expect(rgb('.dark .tab-bar')).toBe(rgb('.dark .glass'))
  })
})
