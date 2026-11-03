jest.mock("@/lib/prisma", () => ({ prisma: null }));
jest.mock("@/lib/storage-backend", () => ({ storageBackend: () => "d1" }));
jest.mock("@/lib/cloudflare/database", () => ({ getD1Database: jest.fn() }));
import { getD1Database } from "@/lib/cloudflare/database";
import { findSavedRecipeSource } from "../saved-recipe-source";
import { createHash } from "node:crypto";
const source = "https://example.org/soup";
const row = {
  id: "saved-a",
  title: "Soup",
  prep_time: 5,
  cook_time: 20,
  servings: 4,
  source_url: source,
  description: null,
};
function setup(legacy: unknown[] = []) {
  const reads: Array<{ sql: string; values: unknown[] }> = [];
  (getD1Database as jest.Mock).mockResolvedValue({
    withSession: () => ({
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => {
          reads.push({ sql, values });
          return {
            first: async () => (values[0] === "family-a" ? row : null),
            all: async () => ({ results: legacy }),
          };
        },
      }),
    }),
  });
  return reads;
}
it("scopes canonical source lookup to the household and normalizes tracking parameters", async () => {
  const reads = setup();
  expect(
    await findSavedRecipeSource("family-a", source + "?utm_source=search"),
  ).toEqual({ ...row, description: undefined });
  expect(reads).toHaveLength(1);
  expect(reads[0].sql).toContain("family_id=?1 AND source_key=?2");
  expect(reads[0].values).toEqual([
    "family-a",
    createHash("sha256").update(source).digest("hex"),
  ]);
});
it("does not return another household's source and bounds legacy lookup", async () => {
  const reads = setup();
  expect(await findSavedRecipeSource("family-b", source)).toBeNull();
  expect(
    reads.every(
      (r) => r.values[0] === "family-b" && r.sql.includes("family_id=?1"),
    ),
  ).toBe(true);
  expect(reads[1].sql).toContain("LIMIT 2001");
});
it("reuses bounded legacy source descriptions and refuses incomplete scans", async () => {
  setup([
    {
      ...row,
      source_url: null,
      description: "Source: " + source + "\nOld import",
    },
  ]);
  expect(await findSavedRecipeSource("family-b", source)).toMatchObject({
    id: row.id,
    source_url: source,
  });
  setup(
    Array.from({ length: 2001 }, () => ({
      ...row,
      description: "Source: https://example.org/other",
    })),
  );
  await expect(findSavedRecipeSource("family-b", source)).rejects.toThrow(
    "incomplete",
  );
});
