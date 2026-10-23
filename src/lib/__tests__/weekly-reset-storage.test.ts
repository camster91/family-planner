/** Source compatibility/erasure cases; no migration or database execution here. */
import type { Prisma } from "@prisma/client";
import {
  clearWeeklyResetInTx,
  exportWeeklyReset,
} from "../weekly-reset-storage";
function fixture(ready: boolean) {
  const query = jest.fn(async (strings: TemplateStringsArray) =>
    strings.join("?").includes("pg_attribute")
      ? [{ ready }]
      : [{ progress: { protocol: "future-own-metadata" }, revision: 2 }],
  );
  const execute = jest.fn();
  return {
    tx: {
      $queryRaw: query,
      $executeRaw: execute,
    } as unknown as Prisma.TransactionClient,
    query,
    execute,
  };
}
it("keeps pre-migration export/removal compatible without touching missing columns", async () => {
  const { tx, query, execute } = fixture(false);
  expect(await exportWeeklyReset(tx, "user-a")).toBeUndefined();
  await clearWeeklyResetInTx(tx, "user-a");
  expect(
    query.mock.calls.every(([parts]) =>
      parts.join("?").includes("pg_attribute"),
    ),
  ).toBe(true);
  expect(execute).not.toHaveBeenCalled();
});
it("clears only the detached account metadata independently of readiness activation", async () => {
  const { tx, execute } = fixture(true);
  await clearWeeklyResetInTx(tx, "user-a");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0].slice(1)).toEqual(["user-a"]);
  expect(execute.mock.calls[0][0].join("?")).toContain(
    '"weekly_reset_progress" IS NOT NULL',
  );
});
it("exports own stored metadata without projecting another household's domain data", async () => {
  const { tx, query } = fixture(true);
  expect(await exportWeeklyReset(tx, "user-a")).toEqual({
    progress: { protocol: "future-own-metadata" },
    revision: 2,
  });
  expect(query.mock.calls[1].slice(1)).toEqual(["user-a"]);
});
