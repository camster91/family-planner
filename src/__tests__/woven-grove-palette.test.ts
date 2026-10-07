import fs from 'fs'
import path from 'path'
const css = fs.readFileSync(path.join(__dirname, '../app/globals.css'), 'utf8')
function tokens(selector: string) {
  const body = css.slice(css.indexOf(`  ${selector} {`)).split('\n  }')[0].replace(/\/\*[\s\S]*?\*\//g, '')
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}
it('preserves all six approved colors as first-class roles, with accessible operational ink and primary actions', () => {
  const light = tokens(':root'), dark = { ...light, ...tokens('.dark') }
  expect(light).toMatchObject({
    '--brand-chalk': '#F7F4EC', '--brand-forest-ink': '#182D2A',
    '--brand-evergreen': '#245B50', '--brand-clay-coral': '#D76C50',
    '--brand-soft-iris': '#C7B8E6', '--brand-pollen': '#E6BD55',
    '--surface-grouped': '#F7F4EC', '--label-primary': '#182D2A',
    '--accent-fill': '#245B50', '--accent-text': '#245B50', '--on-warning': '#182D2A',
  })
  expect(dark).toMatchObject({ '--surface-grouped': '#11211E', '--surface-elevated': '#182D2A' })
  for (const theme of [light, dark]) {
    expect(theme['--accent-text']).not.toBe('#D76C50')
    expect(theme['--warning']).toBe('var(--brand-pollen)')
    expect(theme['--brand-terracotta']).toBe('var(--brand-clay-coral)')
  }
  // Exact approved symbol remains unfiltered and backed by Chalk in BOTH themes.
  expect(css).toMatch(/\.brand-mark\s*\{[^}]*background:\s*var\(--brand-chalk\)/)
  expect(css).toMatch(/\.brand-mark\s*\{[^}]*object-fit:\s*contain/)
  expect(css).toMatch(/\.brand-mark\s*\{[^}]*filter:\s*none/)
})
