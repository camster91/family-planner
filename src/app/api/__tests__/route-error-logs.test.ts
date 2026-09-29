// Privacy-safe logs (docs/architecture/OBSERVABILITY.md, "Prohibited in any
// log line", "Logger field rules" and adoption step 3).
//
// Parses source files (tests excluded) and fails when a log call is handed
// exception or request content. Three scans:
//
// 1. `console.*` under src/app/api (strict). Fails on:
//   * a caught exception: the variable of a `catch (…)` clause or the
//     parameter of a `.catch((…) => …)` callback, alone or inside an
//     expression (`error instanceof Error ? error.message : error`);
//   * any `.message` or `.stack`;
//   * a template literal with substitutions (request values end up in it).
//   Log a failure with `logRouteError(route, error, getRequestId(request))`
//   (or `logRouteWarning`) from src/lib/api-error.ts, which writes only the
//   route, request id, error class name and machine code.
// 2. `console.*` under src/lib. Fails on any `.message`/`.stack` and on a
//   caught exception, except its identity: `err.name`, `err.code`,
//   `err.status`, `err instanceof X` or `describeError(err)`.
// 3. `log.*` (src/lib/logger.ts) anywhere under src. The rules of 2, plus no
//   template literal and no context key that names a person, household or
//   device id or free text (`userId`, `familyId`, `deviceId`, `email`,
//   `label`, `filename`, …). A caught exception may be the second argument of
//   `log.error`: the logger reduces it to errorName/errorCode/errorStatus
//   (src/lib/__tests__/logger.test.ts proves that).
// Prisma and pg messages quote column values, and stacks and request values
// carry household content. A fixed string or an object of safe fields is fine.
//
// ALLOWED is the reviewed exception list: `relative/path.ts:line` entries, each
// with a written reason. It is empty; keep it that way unless a line truly
// cannot use the helpers. The development-only email print in src/lib/mail.ts
// (production throws without MAILGUN_API_KEY) carries no exception content, so
// scan 2 (no template rule) does not flag it.

import fs from 'fs'
import path from 'path'
import ts from 'typescript'

const API_ROOT = path.join(__dirname, '..')
const REPO_ROOT = path.join(API_ROOT, '..', '..', '..')
const SRC_ROOT = path.join(REPO_ROOT, 'src')
const LIB_ROOT = path.join(SRC_ROOT, 'lib')
const LOGGER_FILE = path.join(LIB_ROOT, 'logger.ts')

const ALLOWED: Record<string, string> = {}

type Mode = 'api-console' | 'lib-console' | 'logger'

/** Properties of a caught exception that are its identity, not its content. */
const SAFE_ERROR_PROPS = new Set(['name', 'code', 'status', 'statusCode', 'upstreamStatus'])
/** `log.*` context keys that name a person, household, device or free text. */
const FORBIDDEN_LOG_KEYS =
  /^(userId|actorUserId|familyId|householdId|deviceId|sessionId|connectionId|subscriptionId|ip|email|label|title|text|body|url|filename|file|message|stack|cause|error)$/
const LOG_METHODS = new Set(['debug', 'info', 'warn', 'error'])

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

function isCallOn(node: ts.Node, object: string, methods?: Set<string>): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === object &&
    (!methods || methods.has(node.expression.name.text))
  )
}

function isScannedCall(node: ts.Node, mode: Mode): node is ts.CallExpression {
  return mode === 'logger' ? isCallOn(node, 'log', LOG_METHODS) : isCallOn(node, 'console')
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

/** A use of a caught exception that exposes only its identity. */
function isIdentityUse(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return SAFE_ERROR_PROPS.has(parent.name.text)
  if (ts.isBinaryExpression(parent) && parent.left === node) {
    return parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
  }
  return ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'describeError'
}

/** `log.error(event, caught, …)`: the logger keeps only the identity. */
function isLogErrorThrownArgument(call: ts.CallExpression, node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === 'error' &&
    call.arguments[1] === node
  )
}

/** Why a log call's arguments may leak content, or null when they are safe. */
function argumentProblem(call: ts.CallExpression, caught: Set<string>, mode: Mode): string | null {
  let problem: string | null = null
  const visit = (node: ts.Node) => {
    if (problem) return
    if (
      ts.isIdentifier(node) &&
      caught.has(node.text) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) &&
      !(mode !== 'api-console' && isIdentityUse(node)) &&
      !(mode === 'logger' && isLogErrorThrownArgument(call, node))
    ) {
      problem = `passes the caught exception \`${node.text}\``
    } else if (ts.isPropertyAccessExpression(node) && (node.name.text === 'message' || node.name.text === 'stack')) {
      problem = `passes \`.${node.name.text}\``
    } else if (ts.isTemplateExpression(node) && mode !== 'lib-console') {
      problem = 'interpolates values into the log text'
    } else if (
      mode === 'logger' &&
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      FORBIDDEN_LOG_KEYS.test(node.name.text)
    ) {
      problem = `logs the field \`${node.name.text}\``
    }
    ts.forEachChild(node, visit)
  }
  for (const arg of call.arguments) visit(arg)
  return problem
}

function violations(file: string, text: string, mode: Mode = 'api-console'): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const caught = caughtNames(sf)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (isScannedCall(node, mode)) {
      const problem = argumentProblem(node, caught, mode)
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

describe('library and logger calls carry no exception content', () => {
  it('the library console scan catches content and allows an error identity', () => {
    const bad = [
      "try { x() } catch (error) { console.error('Failed:', error) }",
      "try { x() } catch (err) { console.warn('Failed', { detail: err.message }) }",
      "try { x() } catch (err) { console.warn('Failed', err.response) }",
      "p.catch((e) => console.error('Failed', { e }))",
      "console.error('Failed', new Error('x').stack)",
    ]
    for (const sample of bad) expect(violations('/sample.ts', sample, 'lib-console')).toHaveLength(1)

    const good = [
      "try { x() } catch (err) { console.warn('Failed:', err instanceof Error ? err.name : 'unknown error') }",
      "try { x() } catch (err) { console.warn('Failed', describeError(err)) }",
      "try { x() } catch (err) { console.warn('Failed', { code: err.code, status: err.status }) }",
      'console.log(`[DEV] Email to ${to}`)',
    ]
    for (const sample of good) expect(violations('/sample.ts', sample, 'lib-console')).toEqual([])
  })

  it('the log.* scan catches content, ids and free text and allows the logger-sanitised forms', () => {
    const bad = [
      "try { x() } catch (error) { log.warn('x.failed', { error }) }",
      "try { x() } catch (error) { log.warn('x.failed', { message: error instanceof Error ? error.message : String(error) }) }",
      "try { x() } catch (error) { log.error('x.failed', error, { detail: String(error) }) }",
      "try { x() } catch (error) { log.warn('x.failed', error) }",
      "log.info('upload.photo', { userId: auth.user.id, size })",
      "log.warn('device.token_reuse_detected', { deviceId: row.device_id })",
      "log.info('x', { filename })",
      'log.info(`x.${kind}`)',
    ]
    for (const sample of bad) expect(violations('/sample.ts', sample, 'logger')).toHaveLength(1)

    const good = [
      "try { x() } catch (error) { log.error('device.audit_write_failed', error, { type: entry.type }) }",
      "try { x() } catch (error) { log.error('device.resolve_failed', error, {}) }",
      "try { x() } catch (error) { log.warn('weather.board_failed', describeError(error)) }",
      "try { x() } catch (err) { log.warn('inventory.scan.error', { name: err instanceof Error ? err.name : 'unknown' }) }",
      "try { x() } catch (err) { log.warn('inventory.scan.failed', { code: err.code, upstreamStatus: err.upstreamStatus, bytes: 3 }) }",
      "log.info('upload.photo', { size: buf.length, type: sniffed.mime })",
      "log.error('route.error', { route, requestId, errorName })",
    ]
    for (const sample of good) expect(violations('/sample.ts', sample, 'logger')).toEqual([])
  })

  it('no console call under src/lib passes an exception, its message or stack', () => {
    const files = sourceFiles(LIB_ROOT).filter((file) => file !== LOGGER_FILE)
    expect(files.length).toBeGreaterThan(50)
    const found = files.flatMap((file) => violations(file, fs.readFileSync(file, 'utf8'), 'lib-console'))
    expect(found).toEqual([])
  })

  it('no log.* call under src passes exception content, ids or free text', () => {
    const files = sourceFiles(SRC_ROOT).filter((file) => file !== LOGGER_FILE)
    expect(files.length).toBeGreaterThan(200)
    const found = files.flatMap((file) => violations(file, fs.readFileSync(file, 'utf8'), 'logger'))
    expect(found).toEqual([])
  })
})
