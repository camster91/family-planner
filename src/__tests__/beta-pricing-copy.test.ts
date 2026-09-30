// There is no billing, so the landing and register pages must not promise a
// trial that ends or talk about credit cards (O-23). This scans the message
// catalogue and the two pages that render the pricing line.
import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..')
const FILES = ['i18n/index.tsx', 'app/page.tsx', 'app/(auth)/register/page.tsx']
const BANNED = /free trial|\d+[- ]day trial|credit card|cancel anytime|prueba gratuita de|tarjeta de credito/i

describe('beta pricing copy', () => {
  it.each(FILES)('%s makes no trial or credit-card claims', (rel) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
    expect(src).not.toMatch(BANNED)
  })

  it('says the app is free during the beta', () => {
    const src = fs.readFileSync(path.join(SRC, 'i18n/index.tsx'), 'utf8')
    expect(src).toContain("freeDuringBeta: 'Free during the beta'")
    expect(src).toContain("freeDuringBeta: 'Gratis durante la beta'")
  })
})
