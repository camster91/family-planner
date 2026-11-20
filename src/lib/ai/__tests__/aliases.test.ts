// Household name aliasing (#144): names become placeholders before a provider
// sees them, and placeholders map back to the right people afterwards.
import {
  aliasRoster,
  aliasText,
  buildAliasTable,
  containsHouseholdName,
  resolveAlias,
  unaliasText,
} from "../aliases";

const table = buildAliasTable([
  { key: "account:p1", name: "Jordan Lee" },
  { key: "account:c1", name: "Casey Lee", kind: "child" },
  { key: "profile:m1", name: "Riley" },
]);

describe("buildAliasTable", () => {
  it("gives stable placeholders in household order with separate child labels", () => {
    expect(table.entries.map((e) => [e.alias, e.key])).toEqual([
      ["Person A", "account:p1"],
      ["Child A", "account:c1"],
      ["Person B", "profile:m1"],
    ]);
    expect(aliasRoster(table)).toEqual(["Person A", "Child A", "Person B"]);
  });

  it("skips blank names and duplicate keys and keeps going past Z", () => {
    const many = buildAliasTable([
      { key: "x", name: "  " },
      ...Array.from({ length: 28 }, (_, i) => ({
        key: `k${i}`,
        name: `Name${i} Test`,
      })),
      { key: "k0", name: "Again" },
    ]);
    expect(many.entries).toHaveLength(28);
    expect(many.entries[25].alias).toBe("Person Z");
    expect(many.entries[26].alias).toBe("Person AA");
  });
});

describe("aliasText", () => {
  it("replaces full names, first names and possessives, case-insensitively", () => {
    const out = aliasText(
      "Dentist for casey Tue 3:30; Jordan Lee drives. Riley's swim",
      table,
    );
    expect(out).toBe(
      "Dentist for Child A Tue 3:30; Person A drives. Person B's swim",
    );
    expect(containsHouseholdName(out, table)).toBe(false);
  });

  it("leaves non-household names and partial words alone", () => {
    expect(aliasText("Ask Mrs. Caseyville and Dr. Patel", table)).toBe(
      "Ask Mrs. Caseyville and Dr. Patel",
    );
  });

  it("marks a shared first name as an explicit either", () => {
    const shared = buildAliasTable([
      { key: "a", name: "Sam Ortiz" },
      { key: "b", name: "Sam Park" },
    ]);
    expect(aliasText("Sam has practice; Sam Park too", shared)).toBe(
      "(Person A or Person B) has practice; Person B too",
    );
  });

  it("keeps month-like names from eating dates but aliases them as names", () => {
    const months = buildAliasTable([{ key: "a", name: "April" }]);
    expect(aliasText("April 3 picnic", months)).toBe("April 3 picnic");
    expect(aliasText("April's dentist", months)).toBe("Person A's dentist");
  });

  it("matches everyday-word first names only when capitalized", () => {
    const will = buildAliasTable([{ key: "a", name: "Will Chen" }]);
    expect(aliasText("I will drive Will to soccer", will)).toBe(
      "I will drive Person A to soccer",
    );
  });

  it("never re-matches a replacement", () => {
    const tricky = buildAliasTable([
      { key: "a", name: "Person" },
      { key: "b", name: "Alex" },
    ]);
    expect(aliasText("Alex", tricky)).toBe("Person B");
  });
});

describe("unaliasText and resolveAlias", () => {
  it("maps placeholders back to display names, longest first", () => {
    const many = buildAliasTable(
      Array.from({ length: 28 }, (_, i) => ({ key: `k${i}`, name: `Kid${i}` })),
    );
    expect(unaliasText("Person AA and Person A", many)).toBe("Kid26 and Kid0");
    expect(unaliasText("Dentist for Child A", table)).toBe(
      "Dentist for Casey Lee",
    );
  });

  it("resolves only known placeholders", () => {
    expect(resolveAlias(" child a ", table)).toBe("account:c1");
    expect(resolveAlias("Person Q", table)).toBeNull();
    expect(resolveAlias("Casey Lee", table)).toBeNull();
  });
});
