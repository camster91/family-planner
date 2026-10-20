/** Authored only; actual row-lock/race proof belongs to consolidated PG QA. */
import type { Prisma } from "@prisma/client";
import {
  refuseScheduledRoutineLegacyWrite,
  RoutineScheduleLegacyWriteError,
  refuseScheduledOccurrenceStackWrite,
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
  expect(raw.mock.calls.at(-1)).toContain(true);
});
it("holds future stack/copy adoption by an occurrence editor without changing ordinary stacks", async () => {
  const raw = jest.fn(
    async (..._args: unknown[]): Promise<{ schedule_config: unknown }[]> => [],
  );
  const tx = { $queryRaw: raw };
  await expect(
    refuseScheduledOccurrenceStackWrite(tx, "family-a", null, ["ordinary"]),
  ).resolves.toBeUndefined();
  raw.mockResolvedValueOnce([
    { schedule_config: { protocol: "future-version" } },
  ]);
  await expect(
    refuseScheduledOccurrenceStackWrite(tx, "family-a", "future-stack", [
      "copy",
    ]),
  ).rejects.toBeInstanceOf(RoutineScheduleLegacyWriteError);
  expect(raw.mock.calls[1].slice(1)).toEqual([
    "family-a",
    "future-stack",
    "family-a",
    ["copy"],
  ]);
});
