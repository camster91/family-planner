// API error envelope (docs/architecture/API_CONTRACTS.md "Error envelope",
// #134). Every API error body carries an `error` key: a string (`{ error }`,
// or the flat `apiError` shape `{ error, code, requestId }`) or the nested
// object `{ error: { code, message, ... } }`. Clients read `error`; a body
// that says `message`, `errors` or plain text instead shows nothing useful.
//
// Parses every src/app/api/**/route.ts (tests excluded) and fails on:
//   1. `NextResponse.json(...)` / `Response.json(...)` with a numeric literal
//      `status` of 400 or more whose body is an object literal without an
//      `error` key;
//   2. the same call whose body has an `error` key but whose status is missing
//      or below 400 (an error reported as a success);
//   3. `new NextResponse('text', { status: >= 400 })` / `new Response(...)`
//      with a string body (plain-text error).
// Bodies built elsewhere (shared helpers, variables) and computed statuses are
// not checked here; the shared helpers in src/lib already return `{ error }`.
//
// ALLOWED lists reviewed exceptions as `relative/path.ts` with a reason.

import fs from 'fs'
import path from 'path'
import ts from 'typescript'

const API_ROOT = path.join(__dirname, '..')
const REPO_ROOT = path.join(API_ROOT, '..', '..', '..')

const ALLOWED: Record<string, string> = {
  // Readiness probe: `{ status: 'degraded' }` with 503. The release workflow's
  // post-deploy check and the container orchestrator read `status`.
  'src/app/api/health/route.ts': 'readiness probe body is { status }',
}

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : routeFiles(full)
    return entry.name === 'route.ts' ? [full] : []
  })
}

function literalStatus(options: ts.Expression | undefined): { present: boolean; value: number | null } {
  if (!options || !ts.isObjectLiteralExpression(options)) return { present: false, value: null }
  for (const prop of options.properties) {
    if (!prop.name || !ts.isIdentifier(prop.name) || prop.name.text !== 'status') continue
    if (ts.isPropertyAssignment(prop) && ts.isNumericLiteral(prop.initializer)) {
      return { present: true, value: Number(prop.initializer.text) }
    }
    return { present: true, value: null } // computed status: not checked
  }
  return { present: false, value: null }
}

function hasErrorKey(body: ts.ObjectLiteralExpression): boolean {
  return body.properties.some(
    (prop) =>
      prop.name !== undefined &&
      (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
      prop.name.text === 'error'
  )
}

function isJsonCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'json' &&
    ts.isIdentifier(node.expression.expression) &&
    (node.expression.expression.text === 'NextResponse' || node.expression.expression.text === 'Response')
  )
}

function isResponseConstructor(node: ts.Node): node is ts.NewExpression {
  return (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === 'NextResponse' || node.expression.text === 'Response')
  )
}

export function findViolations(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const out: string[] = []
  const where = (node: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`

  const visit = (node: ts.Node) => {
    if (isJsonCall(node)) {
      const [body, options] = node.arguments
      const status = literalStatus(options)
      if (body && ts.isObjectLiteralExpression(body)) {
        const withError = hasErrorKey(body)
        if (status.value !== null && status.value >= 400 && !withError) {
          out.push(`${where(node)} status ${status.value} body has no "error" key`)
        }
        if (withError && (!status.present || (status.value !== null && status.value < 400))) {
          out.push(`${where(node)} body has "error" but status is ${status.present ? status.value : '200 (default)'}`)
        }
      }
    } else if (isResponseConstructor(node)) {
      const [body, options] = node.arguments ?? []
      const status = literalStatus(options)
      const textBody = body && (ts.isStringLiteral(body) || ts.isNoSubstitutionTemplateLiteral(body))
      if (textBody && status.value !== null && status.value >= 400) {
        out.push(`${where(node)} status ${status.value} plain-text error body; use NextResponse.json({ error })`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

describe('API error envelope', () => {
  it('flags the shapes it is meant to catch', () => {
    const src = `
      NextResponse.json({ message: 'Bad' }, { status: 400 })
      NextResponse.json({ errors: ['x'] }, { status: 422 })
      NextResponse.json({ error: 'Nope' })
      NextResponse.json({ error: 'Nope' }, { status: 200 })
      new NextResponse('Not found', { status: 404 })
      Response.json({ detail: 'x' }, { status: 500 })
      // fine:
      NextResponse.json({ error: 'Bad' }, { status: 400 })
      NextResponse.json({ error: { code: 'X', message: 'm' } }, { status: 409 })
      NextResponse.json({ ok: true })
      NextResponse.json({ status }, { status: ok ? 200 : 503 })
      new NextResponse(buf, { status: 200 })
      new NextResponse(null, { status: 204 })
    `
    expect(findViolations('fixture.ts', src)).toHaveLength(6)
  })

  it('every route under src/app/api returns errors as { error }', () => {
    const files = routeFiles(API_ROOT)
    expect(files.length).toBeGreaterThan(50)
    const violations = files.flatMap((full) => {
      const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/')
      if (ALLOWED[rel]) return []
      return findViolations(rel, fs.readFileSync(full, 'utf8'))
    })
    expect(violations).toEqual([])
  })

  it('keeps the allowlist pointing at real files', () => {
    for (const rel of Object.keys(ALLOWED)) {
      expect(fs.existsSync(path.join(REPO_ROOT, rel))).toBe(true)
    }
  })
})
