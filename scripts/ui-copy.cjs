// #403 / #142: additive tracking gate; inventory entries remain migration debt.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const VISIBLE_ATTRIBUTES = new Set([
  'aria-label', 'aria-description', 'alt', 'title', 'placeholder',
  'label', 'description', 'emptyTitle', 'emptyDescription',
  'confirmLabel', 'cancelLabel',
]);

/** @typedef {{file: string, text: string, line: number}} Occurrence */
/** @typedef {{file: string, text: string, count: number}} CopyRecord */

/** @param {string} file @param {string} code @returns {Occurrence[]} */
function collectUiCopy(file, code) {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  /** @type {Occurrence[]} */
  const found = [];
  /** @param {string} text @param {import('typescript').Node} node */
  const add = (text, node) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!/[\p{L}\p{N}]/u.test(normalized)) return;
    found.push({ file, text: normalized, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
  };
  // Inspect only values returned into the JSX surface, not role comparisons,
  // routing/style literals, arbitrary call arguments or translation keys.
  /** @param {import('typescript').Expression} node */
  const returnedCopy = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text, node);
    else if (ts.isTemplateExpression(node)) {
      add(node.head.text, node.head);
      for (const span of node.templateSpans) add(span.literal.text, span.literal);
    } else if (ts.isConditionalExpression(node)) {
      returnedCopy(node.whenTrue);
      returnedCopy(node.whenFalse);
    } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      returnedCopy(node.expression);
    } else if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) returnedCopy(node.right);
      else if ([ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(op)) {
        returnedCopy(node.left);
        returnedCopy(node.right);
      }
    }
  };
  /** @param {import('typescript').Node} node */
  const visit = (node) => {
    if (ts.isJsxText(node)) add(node.text, node);
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) returnedCopy(node.expression);
    if (ts.isJsxAttribute(node) && VISIBLE_ATTRIBUTES.has(node.name.getText(source)) && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) add(node.initializer.text, node.initializer);
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) returnedCopy(node.initializer.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** @param {string} root @returns {Occurrence[]} */
function scanUiCopy(root) {
  /** @type {Occurrence[]} */
  const findings = [];
  /** @param {string} directory */
  const walk = (directory) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (item.isDirectory()) {
        if (item.name === '__tests__' || relative === 'src/app/dev') continue;
        walk(full);
      } else if (item.name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(item.name)) {
        findings.push(...collectUiCopy(relative, fs.readFileSync(full, 'utf8')));
      }
    }
  };
  walk(path.join(root, 'src'));
  return findings;
}

/** @param {Occurrence[]} occurrences @returns {CopyRecord[]} */
function summarizeCopy(occurrences) {
  /** @type {Map<string, CopyRecord>} */
  const records = new Map();
  for (const occurrence of occurrences) {
    const key = JSON.stringify([occurrence.file, occurrence.text]);
    const prior = records.get(key);
    if (prior) prior.count += 1;
    else records.set(key, { file: occurrence.file, text: occurrence.text, count: 1 });
  }
  return [...records.values()].sort((a, b) => a.file.localeCompare(b.file, 'en') || a.text.localeCompare(b.text, 'en'));
}

/** @param {Occurrence[]} occurrences @param {CopyRecord[]} tracked @returns {string[]} */
function copyTrackingDifferences(occurrences, tracked) {
  const actual = summarizeCopy(occurrences);
  const key = (/** @type {CopyRecord} */ row) => JSON.stringify([row.file, row.text]);
  const old = new Map(tracked.map(row => [key(row), row]));
  const now = new Map(actual.map(row => [key(row), row]));
  /** @type {string[]} */
  const differences = [];
  const seen = new Set();
  for (const row of tracked) {
    if (seen.has(key(row))) differences.push(`${row.file}: duplicate migration record: ${JSON.stringify(row.text)}`);
    seen.add(key(row));
    if (!Number.isInteger(row.count) || row.count < 1) differences.push(`${row.file}: invalid migration occurrence count`);
  }
  for (const row of actual) {
    if (old.get(key(row))?.count !== row.count) {
      const line = occurrences.find(x => x.file === row.file && x.text === row.text)?.line;
      differences.push(`${row.file}:${line}: untracked/changed copy (${row.count} occurrences): ${JSON.stringify(row.text)}`);
    }
  }
  for (const row of tracked) {
    if (!now.has(key(row))) differences.push(`${row.file}: stale migration record: ${JSON.stringify(row.text)}`);
  }
  return differences;
}

module.exports = { collectUiCopy, scanUiCopy, summarizeCopy, copyTrackingDifferences };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const inventory = path.join(root, 'src/i18n/untranslated-copy.json');
  const occurrences = scanUiCopy(root);
  if (process.argv.includes('--write-inventory')) {
    fs.writeFileSync(inventory, JSON.stringify(summarizeCopy(occurrences), null, 2) + '\n');
    console.log(`Recorded ${occurrences.length} hard-coded copy occurrences; review the inventory diff. This does not approve or translate them.`);
  } else {
    const differences = copyTrackingDifferences(occurrences, JSON.parse(fs.readFileSync(inventory, 'utf8')));
    if (differences.length) { console.error(differences.join('\n')); process.exitCode = 1; }
    else console.log(`All ${occurrences.length} detected hard-coded copy occurrences are tracked for review/migration.`);
  }
}
