/** Authored only; actual row-lock/race proof belongs to consolidated PG QA. */
import type { Prisma } from "@prisma/client";
import {
  refuseScheduledRoutineLegacyWrite,
  RoutineScheduleLegacyWriteError,
} from "../routine-schedule-legacy";
it("holds known and unknown private root definitions, without changing ordinary legacy rows", async () => {
  const raw = jest.fn(
    async (
      ..._args: unknown[]
    ): Promise<{ routine_series_config: unknown }[]> => [
      { routine_series_config: null },
    ],
  );
  const tx = { $queryRaw: raw } as unknown as Prisma.TransactionClient;
  await expect(
    refuseScheduledRoutineLegacyWrite(tx, "family-a", "root-a"),
  ).resolves.toBeUndefined();
  raw.mockResolvedValueOnce([
    { routine_series_config: { protocol: "future-version" } },
  ]);
  await expect(
    refuseScheduledRoutineLegacyWrite(tx, "family-a", "root-a", true),
  ).rejects.toBeInstanceOf(RoutineScheduleLegacyWriteError);
  expect(raw.mock.calls[1]).toContain(true);
});
