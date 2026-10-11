import fs from "node:fs";
import path from "node:path";
const {
  collectMemberSubjects,
  subjectDifferences,
} = require("../../scripts/member-subject-contract.cjs");
const root = path.resolve(__dirname, "../..");
const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const inventory = JSON.parse(
  fs.readFileSync(
    path.join(root, "docs/architecture/member-subject-inventory.json"),
    "utf8",
  ),
);
it("classifies all canonical member owners without replacing account-owner decisions", () => {
  expect(subjectDifferences(collectMemberSubjects(schema), inventory)).toEqual(
    [],
  );
  expect(collectMemberSubjects(schema)).toHaveLength(4);
});
it("fails when a new member subject has no migration and erasure decision", () => {
  const extra = `\nmodel Extra {\n person HouseholdMember? @relation(fields: [person_id, family_id], references: [id, family_id], onDelete: NoAction, onUpdate: NoAction)\n}\n`;
  expect(
    subjectDifferences(collectMemberSubjects(schema + extra), inventory),
  ).toContain("Extra.person: unclassified canonical member owner");
});
it.each(["fields", "references", "onDelete", "onUpdate"])(
  "rejects a weakened %s contract",
  (key) => {
    const actual = collectMemberSubjects(schema);
    actual[0][key] =
      key === "onDelete" ? "Cascade" : key === "onUpdate" ? "Cascade" : ["id"];
    expect(subjectDifferences(actual, inventory)).toContain(
      `${actual[0].relation}: ${key} changed`,
    );
  },
);
it("rejects stale and missing decisions", () => {
  expect(
    subjectDifferences(collectMemberSubjects(schema).slice(1), inventory),
  ).toContain("Chore.assigneeMember: stale canonical subject decision");
  expect(
    subjectDifferences(
      collectMemberSubjects(schema),
      inventory.map((v: object) => ({ ...v, decision: "" })),
    ),
  ).toContain("Invalid or duplicate canonical subject decision");
});
