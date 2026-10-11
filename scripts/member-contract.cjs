// #480: migration inventory, not an authorization policy or a completed migration.
const fs = require('node:fs');
const path = require('node:path');

/** Explicit User FK owners only. Inverse/list relations are not new owners. */
function collectUserRelations(schema) {
  const source = schema.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const relations = [];
  for (const model of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    for (const field of model[2].matchAll(/^\s*(\w+)\s+User(\?|\[\])?\s*(?:@relation\(([\s\S]*?)\))?/gm)) {
      if (field[2] === '[]' || !field[3]) continue;
      const owned = /\bfields\s*:\s*\[([^\]]+)\]/.exec(field[3]);
      if (!owned) continue;
      relations.push({ relation: `${model[1]}.${field[1]}`, fields: owned[1].split(',').map(value => value.trim()) });
    }
  }
  if (!relations.length) throw new Error('No explicit User relations found; inspect schema/parser before trusting this inventory.');
  return relations.sort((a, b) => a.relation.localeCompare(b.relation));
}

function memberContractDifferences(actual, inventory) {
  const errors = [];
  const entries = new Map();
  const kinds = new Set(['member', 'account', 'actor', 'actor-and-member']);
  for (const entry of inventory) {
    if (!entry || typeof entry.relation !== 'string' || !Array.isArray(entry.fields) || !entry.fields.length || entry.fields.some(field => typeof field !== 'string' || !field)) {
      errors.push('Invalid relation inventory entry'); continue;
    }
    if (entries.has(entry.relation)) errors.push(`${entry.relation}: duplicate inventory entry`);
    if (!kinds.has(entry.kind) || typeof entry.migration !== 'string' || !entry.migration.trim()) errors.push(`${entry.relation}: missing classification or migration decision`);
    entries.set(entry.relation, entry);
  }
  const seen = new Set();
  for (const row of actual) {
    if (seen.has(row.relation)) errors.push(`${row.relation}: duplicate schema owner`);
    seen.add(row.relation);
    const entry = entries.get(row.relation);
    if (!entry) errors.push(`${row.relation}: unclassified User relation`);
    else if (JSON.stringify(entry.fields) !== JSON.stringify(row.fields)) errors.push(`${row.relation}: foreign key fields changed`);
  }
  for (const name of entries.keys()) if (!seen.has(name)) errors.push(`${name}: stale inventory entry`);
  return errors;
}

module.exports = { collectUserRelations, memberContractDifferences };
if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const actual = collectUserRelations(fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8'));
    const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs/architecture/member-relation-inventory.json'), 'utf8'));
    const errors = memberContractDifferences(actual, inventory);
    if (errors.length) { process.stderr.write(errors.join('\n') + '\n'); process.exitCode = 1; }
    else process.stdout.write(`${actual.length} User relations classified. This proves inventory coverage only, not profile support or migration readiness.\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
