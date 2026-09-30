// Every in-app page link in src points at a page that exists.
//
// The user menu linked parents to /dashboard/profile, which has never existed
// (a 404 from the main menu). This scans `href="/…"`, `href={`/…`}`,
// `href: '/…'`, `router.push('/…')`, `router.replace('/…')` and
// `redirect('/…')` in src and resolves each against the App Router pages and
// route handlers under src/app, treating `${…}` and `[param]` as one segment.
import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..')
const APP = path.join(SRC, 'app')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      walk(full, out)
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function routePatterns(): RegExp[] {
  return walk(APP)
    .filter((f) => /[/\\](page|route)\.(tsx?|jsx?)$/.test(f))
    .map((f) => {
      const rel = path
        .relative(APP, path.dirname(f))
        .split(path.sep)
        .filter((seg) => seg && !/^\(.*\)$/.test(seg))
        .map((seg) => (/^\[.*\]$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      return new RegExp(`^/${rel.join('/')}/?$`)
    })
}

const LINK = /(?:href=\{?|href:\s*|\.push\(|\.replace\(|\bredirect\()\s*[`'"](\/[^`'"?#\s]*)/g

describe('internal page links', () => {
  it('resolve to an existing page or route', () => {
    const patterns = routePatterns()
    const broken: string[] = []
    for (const file of walk(SRC)) {
      const text = fs.readFileSync(file, 'utf8')
      for (const match of text.matchAll(LINK)) {
        const target = match[1].replace(/\$\{[^}]*\}/g, 'x').replace(/\/$/, '') || '/'
        if (target === '/') continue
        if (!patterns.some((p) => p.test(target))) {
          broken.push(`${path.relative(SRC, file)}: ${target}`)
        }
      }
    }
    expect(broken).toEqual([])
  })
})
