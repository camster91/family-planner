import { listVersion } from "../list-version";
const T = new Date("2026-01-01T00:00:00.000Z");
const list = { id: "list-a", updated_at: T };
const a = { id: "a", updated_at: T };
const b = { id: "b", updated_at: new Date(T.getTime() + 100) };
it("is independent of query row ordering and returns only an opaque digest", () => {
  expect(listVersion(list, [a, b])).toBe(listVersion(list, [b, a]));
  expect(listVersion(list, [a, b])).toMatch(/^[a-f0-9]{64}$/);
});
it("detects an older-row edit even when count and maximum timestamp stay unchanged", () => {
  expect(listVersion(list, [a, b])).not.toBe(
    listVersion(list, [{ ...a, updated_at: new Date(T.getTime() + 1) }, b]),
  );
});
it("detects equal-count replacements even with equal timestamps", () => {
  expect(listVersion(list, [a, b])).not.toBe(
    listVersion(list, [{ ...a, id: "replacement" }, b]),
  );
});
it("detects insertion, deletion and an empty list", () => {
  expect(
    new Set([
      listVersion(list, []),
      listVersion(list, [a]),
      listVersion(list, [a, b]),
    ]).size,
  ).toBe(3);
});
it("detects list metadata versions and separates different list identities", () => {
  expect(listVersion(list, [a])).not.toBe(
    listVersion({ ...list, updated_at: new Date(T.getTime() + 1) }, [a]),
  );
  expect(listVersion(list, [a])).not.toBe(
    listVersion({ ...list, id: "other-list" }, [a]),
  );
});
it("never mutates the caller snapshot or needs content or credentials", () => {
  const rows = Object.freeze([Object.freeze(b), Object.freeze(a)]);
  expect(() => listVersion(Object.freeze(list), rows)).not.toThrow();
  expect(rows[0]).toBe(b);
});
