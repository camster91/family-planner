// Canonical member FK coverage is separate from the retained User inventory.
const fs = require("node:fs");
const path = require("node:path");
function collectMemberSubjects(schema) {
  const source = schema
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const rows = [];
  for (const model of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    for (const field of model[2].matchAll(
      /^\s*(\w+)\s+HouseholdMember(\?|\[\])?\s*(?:@relation\(([\s\S]*?)\))?/gm,
    )) {
      if (field[2] === "[]" || !field[3]) continue;
      const list = (key) =>
        new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]+)\\]`)
          .exec(field[3])?.[1]
          .split(",")
          .map((v) => v.trim());
      const fields = list("fields");
      if (!fields) continue;
      rows.push({
        relation: `${model[1]}.${field[1]}`,
        fields,
        references: list("references"),
        onDelete: /\bonDelete\s*:\s*(\w+)/.exec(field[3])?.[1],
        onUpdate: /\bonUpdate\s*:\s*(\w+)/.exec(field[3])?.[1],
      });
    }
  }
  if (!rows.length)
    throw new Error("No canonical member owners found; inspect parser/schema.");
  return rows.sort((a, b) => a.relation.localeCompare(b.relation));
}
function subjectDifferences(actual, inventory) {
  const errors = [];
  const entries = new Map();
  for (const entry of inventory) {
    if (
      !entry?.relation ||
      !entry?.decision?.trim() ||
      entries.has(entry.relation)
    )
      errors.push("Invalid or duplicate canonical subject decision");
    entries.set(entry?.relation, entry);
  }
  for (const row of actual) {
    const expected = entries.get(row.relation);
    if (!expected) {
      errors.push(`${row.relation}: unclassified canonical member owner`);
      continue;
    }
    for (const key of ["fields", "references", "onDelete", "onUpdate"])
      if (JSON.stringify(row[key]) !== JSON.stringify(expected[key]))
        errors.push(`${row.relation}: ${key} changed`);
    entries.delete(row.relation);
  }
  for (const key of entries.keys())
    errors.push(`${key}: stale canonical subject decision`);
  return errors;
}
module.exports = { collectMemberSubjects, subjectDifferences };
if (require.main === module) {
  try {
    const root = path.resolve(__dirname, "..");
    const actual = collectMemberSubjects(
      fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8"),
    );
    const inventory = JSON.parse(
      fs.readFileSync(
        path.join(root, "docs/architecture/member-subject-inventory.json"),
        "utf8",
      ),
    );
    const errors = subjectDifferences(actual, inventory);
    if (errors.length) {
      process.stderr.write(errors.join("\n") + "\n");
      process.exitCode = 1;
    } else
      process.stdout.write(
        `${actual.length} canonical member relations classified. Inventory only; not activated assignment or erasure acceptance.\n`,
      );
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  }
}
