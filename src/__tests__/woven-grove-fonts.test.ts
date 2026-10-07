import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

const root = path.join(__dirname, '../..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const digest = (file: string) => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')

it('ships the approved real variable font sources and OFL licenses without Google build requests', () => {
  const layout = read('src/app/layout.tsx')
  expect(layout).toContain("from 'next/font/local'")
  expect(layout).not.toContain('next/font/google')
  expect(layout).toContain("src: './fonts/Newsreader-variable.ttf'")
  expect(layout).toContain("src: './fonts/Manrope-variable.ttf'")
  expect(layout).toContain("weight: '200 800'")
  expect(layout).toContain("variable: '--font-newsreader'")
  expect(layout).toContain("variable: '--font-manrope'")
  expect(layout).toContain('${newsreader.variable} ${manrope.variable}')
  expect(digest('src/app/fonts/Newsreader-variable.ttf')).toBe('8a08d13f8a6c0d51be379a60af84f945f65369a67e509ee3c3bdcc421254d7c1')
  expect(digest('src/app/fonts/Manrope-variable.ttf')).toBe('3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6')
  for (const font of ['Newsreader', 'Manrope']) expect(read(`src/app/fonts/${font}-OFL.txt`)).toContain('SIL OPEN FONT LICENSE')
  const css = read('src/app/globals.css')
  expect(css).toContain('--font-family-serif: var(--font-newsreader)')
  expect(css).toContain('--font-family-sans: var(--font-manrope)')
  expect(css).not.toMatch(/font-fraunces|font-inter|"SOFT"/)
})
