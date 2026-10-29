#!/usr/bin/env node
/** Source audit only. Does not provision, connect to a database, or expose env values. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const findings = [];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (['__tests__', '__mocks__'].includes(entry.name)) return [];
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec|stories)\./.test(entry.name) ? [p] : [];
  });
}
for (const file of walk(path.join(root, 'src'))) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const relative = path.relative(root, file).split(path.sep).join('/');
  const add = (node, kind, detail) => findings.push({ file: relative, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, kind, detail });
  const property = node => ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const name = property(node.expression);
      if (name === '$transaction') {
        const arg = node.arguments[0];
        add(node, 'transaction', arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) ? 'callback' : arg && ts.isArrayLiteralExpression(arg) ? 'batch' : 'indirect');
      }
      if (['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe'].includes(name)) add(node, 'raw_sql', name);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0]) && /^(node:)?fs(\/promises)?$/.test(node.arguments[0].text)) add(node, 'filesystem', 'dynamic import');
    }
    if (ts.isTaggedTemplateExpression(node) && ['$queryRaw', '$executeRaw'].includes(property(node.tag))) add(node, 'raw_sql', property(node.tag));
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /^(node:)?fs(\/promises)?$/.test(node.moduleSpecifier.text)) add(node, 'filesystem', 'static import');
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (/\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b/i.test(node.text)) add(node, 'row_lock', 'FOR UPDATE');
      if (/\bpg_advisory\w*\b/.test(node.text)) add(node, 'advisory_lock', 'pg_advisory');
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const modelNames = [...schema.matchAll(/^model\s+(\w+)/gm)].map(m => m[1]);
const scalarLists = [];
let model;
for (const [index, line] of schema.split('\n').entries()) {
  const declaration = /^model\s+(\w+)/.exec(line);
  if (declaration) model = declaration[1];
  const field = /^\s+(\w+)\s+(String|Int|Float|Boolean|DateTime|Json|Decimal|BigInt|Bytes)\[\]/.exec(line);
  if (field) scalarLists.push({ model, field: field[1], type: field[2], line: index + 1 });
}
const totals = Object.fromEntries(['transaction', 'raw_sql', 'filesystem', 'row_lock', 'advisory_lock'].map(kind => [kind, {
  occurrences: findings.filter(f => f.kind === kind).length,
  files: new Set(findings.filter(f => f.kind === kind).map(f => f.file)).size,
}]));
const report = {
  schema: 'herewoven/cloudflare-source-inventory@1',
  scope: 'AST call/import/string sites in src, excluding test/mock/story files; SQL strings are indicators, not SQL parsing or proof of compatibility.',
  models: modelNames.length,
  scalarLists,
  totals,
  findings,
};
console.log(JSON.stringify(process.argv.includes('--summary') ? { ...report, findings: undefined } : report, null, 2));
