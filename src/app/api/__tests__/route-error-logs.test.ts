// Privacy-safe route logs (docs/architecture/OBSERVABILITY.md, "Prohibited in
// any log line" and adoption step 3).
//
// Reads every source file under src/app/api (tests excluded) and fails when a
// `console.*` call is handed:
//   * a caught exception: the variable of a `catch (…)` clause or the
//     parameter of a `.catch((…) => …)` callback, alone or inside an
//     expression (`error instanceof Error ? error.message : error`);
//   * any `.message` or `.stack`;
//   * a template literal with substitutions (request values end up in it).
// Prisma and pg messages quote column values, and stacks and request values
// carry household content. Log a failure with
// `logRouteError(route, error, getRequestId(request))` (or `logRouteWarning`)
// from src/lib/api-error.ts, which writes only the route, request id, error
// class name and machine code. A fixed string (`console.error('Health check
// failed')`) or an object of safe fields is fine.
//
// ALLOWED is the reviewed exception list: `relative/path.ts:line` entries, each
// with a written reason. It is empty; keep it that way unless a line truly
// cannot use the helper.

import fs from 'fs'
import path from 'path'
import ts from 'typescript'

const API_ROOT = path.join(__dirname, '..')
const REPO_ROOT = path.join(API_ROOT, '..', '..', '..')

const ALLOWED: Record<string, string> = {}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

function isConsoleCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'console'
  )
}

/** Names bound to a caught exception anywhere in the file. */
function caughtNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) {
      names.add(node.variableDeclaration.name.text)
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'catch'
    ) {
      const callback = node.arguments[0]
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        for (const param of callback.parameters) if (ts.isIdentifier(param.name)) names.add(param.name.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

/** Why a console call's arguments may leak content, or null when they are safe. */
function argumentProblem(call: ts.CallExpression, caught: Set<string>): string | null {
  let problem: string | null = null
  const visit = (node: ts.Node) => {
    if (problem) return
    if (ts.isIdentifier(node) && caught.has(node.text) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
      problem = `passes the caught exception \`${node.text}\``
    } else if (ts.isPropertyAccessExpression(node) && (node.name.text === 'message' || node.name.text === 'stack')) {
      problem = `passes \`.${node.name.text}\``
    } else if (ts.isTemplateExpression(node)) {
      problem = 'interpolates values into the log text'
    }
    ts.forEachChild(node, visit)
  }
  for (const arg of call.arguments) visit(arg)
  return problem
}

function violations(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const caught = caughtNames(sf)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (isConsoleCall(node)) {
      const problem = argumentProblem(node, caught)
      if (problem) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        const where = `${path.relative(REPO_ROOT, file).split(path.sep).join('/')}:${line}`
        if (!(where in ALLOWED)) found.push(`${where} ${problem}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

describe('route error logs carry no exception content', () => {
  it('the scan catches the patterns it is meant to', () => {
    const bad = [
      "try { x() } catch (error) { console.error('Failed:', error) }",
      "try { x() } catch (err) { console.warn('Failed:', err instanceof Error ? err.message : 'unknown') }",
      "try { x() } catch (e) {\n  console.error(\n    'Failed',\n    e\n  )\n}",
      "p.catch((e) => console.error('Failed', e))",
      "console.error('Failed', new Error('x').stack)",
      'console.warn(`Type ${type} does not match`)',
    ]
    for (const sample of bad) expect(violations('/sample.ts', sample)).toHaveLength(1)

    const good = [
      "try { x() } catch { console.error('Health check failed') }",
      "try { x() } catch (error) { logRouteError('GET /api/x', error, getRequestId(request)) }",
      "try { x() } catch (err) { console.warn('[calendar-sync] code exchange failed', { provider }) }",
      "console.warn('Transaction type does not match its category type')",
    ]
    for (const sample of good) expect(violations('/sample.ts', sample)).toEqual([])
  })

  it('no file under src/app/api logs an exception, its message or stack, or interpolated values', () => {
    const files = sourceFiles(API_ROOT)
    expect(files.length).toBeGreaterThan(100)
    const found = files.flatMap((file) => violations(file, fs.readFileSync(file, 'utf8')))
    expect(found).toEqual([])
  })

  it('every allowlist entry still exists and has a reason', () => {
    for (const [where, reason] of Object.entries(ALLOWED)) {
      expect(reason.trim().length).toBeGreaterThan(10)
      expect(fs.existsSync(path.join(REPO_ROOT, where.split(':')[0]))).toBe(true)
    }
  })
})
