// Design gallery fixtures and isolation (#156): deterministic, clearly fake
// data, and no gallery file reaches the database, the network or a session.
import fs from 'fs'
import path from 'path'
import { galleryFixtures, pseudolocalize } from '../fixtures'

const GALLERY_DIR = path.join(__dirname, '..')

function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (value instanceof Map) for (const v of value.values()) allStrings(v, out)
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) allStrings(v, out)
  return out
}

const VARIANTS = [
  { long: false, empty: false },
  { long: true, empty: false },
  { long: false, empty: true },
  { long: true, empty: true },
]

describe('galleryFixtures', () => {
  it.each(VARIANTS)('is deterministic (%o)', (variant) => {
    expect(JSON.stringify(galleryFixtures(variant))).toBe(JSON.stringify(galleryFixtures(variant)))
  })

  it.each(VARIANTS)('contains no real-looking personal data (%o)', (variant) => {
    const strings = allStrings(galleryFixtures(variant))
    for (const s of strings) {
      expect(s).not.toMatch(/@/) // emails, handles
      expect(s).not.toMatch(/https?:\/\//) // external URLs
      expect(s).not.toMatch(/\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/) // phone numbers
      expect(s).not.toMatch(/\b\d+\s+\w+\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd)\b/i) // addresses
    }
  })

  it('uses only "<name> Sample" members and fx-gallery ids', () => {
    const fx = galleryFixtures()
    for (const m of fx.members) {
      expect(m.name).toMatch(/^\w+ Sample$/)
      expect(m.id).toMatch(/^fx-gallery-/)
    }
    expect(fx.weather.weather.label).toBe('Sampleton')
    for (const e of fx.todayEvents) {
      expect(e.id).toMatch(/^fx-gallery-/)
      // Local wall-clock times (no zone), so rendering never depends on the server zone.
      expect(e.start).not.toMatch(/Z$/)
    }
  })

  it('empty data is empty for every data-driven component', () => {
    const fx = galleryFixtures({ empty: true })
    expect(fx.todayEvents).toEqual([])
    expect(fx.dinner).toBeNull()
    expect(fx.shopping).toEqual({ items: [], total: 0 })
    expect(fx.personChores).toEqual([])
    expect(fx.routines).toEqual([])
    expect(fx.useSoon).toEqual([])
    expect(fx.listRows).toEqual([])
    expect(fx.comingUp.every((d) => d.events.length === 0 && d.dinner === null)).toBe(true)
  })

  it('pseudolocalises into longer, accented text that can still wrap', () => {
    const out = pseudolocalize('Swimming lesson')
    expect(out.startsWith('[Šŵîɱɱîñĝ ļéššöñ')).toBe(true)
    expect(out.length).toBeGreaterThanOrEqual(Math.ceil('Swimming lesson'.length * 1.5))
    expect(Math.max(...out.split(' ').map((w) => w.length))).toBeLessThanOrEqual(12)
  })
})

describe('gallery isolation', () => {
  const files = fs.readdirSync(GALLERY_DIR).filter((f) => /\.(ts|tsx)$/.test(f))

  it('has the expected files', () => {
    expect(files).toEqual(
      expect.arrayContaining(['page.tsx', 'gate.ts', 'options.ts', 'fixtures.ts', 'DesignGallery.tsx', 'sections.tsx', 'frame.tsx'])
    )
  })

  it.each(files)('%s imports no database, session or server data loader and never fetches', (file) => {
    const source = fs.readFileSync(path.join(GALLERY_DIR, file), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // Runtime imports only; `import type` is erased at build.
    const runtimeImports = [...code.matchAll(/^import\s+(?!type\b)[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    for (const spec of runtimeImports) {
      expect(spec).not.toMatch(/prisma|^pg$|@\/lib\/(session|auth|api-auth|api-client|feature-gate-server)$|today-board-data|shopping-snapshot$/)
      expect(spec).not.toMatch(/\/page$/)
    }
    expect(code).not.toMatch(/\bfetch\s*\(/)
    expect(code).not.toMatch(/\bprisma\b/i)
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB/)
  })
})
