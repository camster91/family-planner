import fs from 'fs'
import path from 'path'

it('provides one display-only Herewoven brand contract', () => {
  expect(fs.existsSync(path.join(__dirname, '../brand.ts'))).toBe(true)
  const { PRODUCT_BRAND } = require('../brand')
  expect(PRODUCT_BRAND).toEqual({
    name: 'Herewoven',
    tagline: 'Everyday life, held together.',
    description: 'A shared place for the everyday work of home.',
    homeLabel: 'Herewoven home',
    legacyName: 'Family Planner',
  })
})
