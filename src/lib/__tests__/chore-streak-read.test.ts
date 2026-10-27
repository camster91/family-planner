/** Authored source only; no database/performance acceptance implied. */
import { choreStreakDays, readChoreStreaks, CHORE_STREAK_ASSIGNEE_BATCH } from "../chore-streak-read";
const now = new Date("2026-10-24T12:00:00.000Z");
const days = choreStreakDays(now);
it("does not query for an empty or profile-only displayed assignee set", async () => {
  const $queryRaw = jest.fn();
  expect(await readChoreStreaks({ $queryRaw } as never, "family-a", [null, undefined], now)).toEqual({});
  expect($queryRaw).not.toHaveBeenCalled();
});
it("keeps seven-day maximum, three-day display threshold and a gap stopping the streak", async () => {
  const rows = [
    ...days.map(day => ({ assigned_to: "account-a", day })),
    ...days.slice(0, 2).map(day => ({ assigned_to: "account-b", day })),
    ...[days[0], days[1], days[2], days[4]].map(day => ({ assigned_to: "account-c", day })),
  ];
  const $queryRaw = jest.fn(async () => rows);
  expect(await readChoreStreaks({ $queryRaw } as never, "family-a", ["account-a", "account-b", "account-c", "account-d"], now))
    .toEqual({ "account-a": 7, "account-b": 0, "account-c": 3, "account-d": 0 });
  const sql = ($queryRaw.mock.calls as unknown as Array<[{ strings: string[]; values: unknown[] }]>)[0][0];
  expect(sql.strings.join("?")).toContain('"family_id"=');
  expect(sql.strings.join("?")).not.toContain('"title"');
  expect(sql.values[0]).toBe("family-a");
});
it("batches only unique visible accounts without truncating a later batch", async () => {
  const ids = Array.from({ length: CHORE_STREAK_ASSIGNEE_BATCH + 1 }, (_, i) => `account-${i}`);
  const $queryRaw = jest.fn(async (sql: { values: unknown[] }) => sql.values
    .filter((value): value is string => typeof value === "string" && value.startsWith("account-"))
    .flatMap(assigned_to => days.slice(0, 3).map(day => ({ assigned_to, day }))));
  const result = await readChoreStreaks({ $queryRaw } as never, "family-a", [...ids, ids[0], null], now);
  expect($queryRaw).toHaveBeenCalledTimes(2);
  expect(Object.keys(result)).toHaveLength(ids.length);
  expect(result[ids[ids.length - 1]]).toBe(3);
  expect($queryRaw.mock.calls[0][0].values.filter(v => typeof v === "string" && v.startsWith("account-")))
    .toHaveLength(CHORE_STREAK_ASSIGNEE_BATCH);
});
it.each([
  [{ assigned_to: "foreign-account", day: days[0] }],
  [{ assigned_to: "account-a", day: "1900-01-01" }],
  [{ assigned_to: "account-a", day: days[0] }, { assigned_to: "account-a", day: days[0] }],
  Array.from({ length: 8 }, () => ({ assigned_to: "account-a", day: days[0] })),
].map(rows => [rows] as const))("fails closed for out-of-scope/duplicate/oversized projections", async rows => {
  const $queryRaw = jest.fn(async () => rows);
  await expect(readChoreStreaks({ $queryRaw } as never, "family-a", ["account-a"], now)).rejects.toThrow();
});
