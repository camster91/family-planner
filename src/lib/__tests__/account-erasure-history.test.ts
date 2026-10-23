/** Authored source only; erasure DB/file acceptance is deferred. */
import type { Prisma } from "@prisma/client";
import {
  accountErasureHistoryHouseholds,
  eraseRetainedAccountHistoryInTx,
} from "../account-erasure-history";
it("discovers only exact account references and returns distinct ordered household locks", async () => {
  const messages = jest
    .fn()
    .mockResolvedValue([{ family_id: "z" }, { family_id: "a" }]);
  const audits = jest
    .fn()
    .mockResolvedValue([{ family_id: "a" }, { family_id: "b" }]);
  const tx = {
    message: { findMany: messages },
    auditLog: { findMany: audits },
  } as unknown as Prisma.TransactionClient;
  expect(await accountErasureHistoryHouseholds(tx, "departing")).toEqual([
    "a",
    "b",
    "z",
  ]);
  expect(messages).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        OR: [{ sender_id: "departing" }, { read_by: { has: "departing" } }],
      },
    }),
  );
  expect(audits).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        OR: [
          { actor_user_id: "departing" },
          { target_type: "member", target_id: "departing" },
        ],
      },
    }),
  );
});
it("redacts only member-target text/actor identity and exact read markers in locked households", async () => {
  const update = jest.fn(),
    execute = jest.fn();
  const tx = {
    auditLog: { updateMany: update },
    $executeRaw: execute,
  } as unknown as Prisma.TransactionClient;
  await eraseRetainedAccountHistoryInTx(
    tx,
    { id: "departing", role: "child" },
    ["b", "a", "a"],
  );
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls.map((call) => call.slice(1))).toEqual([
    ["departing", "a", "departing"],
    ["departing", "b", "departing"],
  ]);
  const args = update.mock.calls.map(([arg]) => arg);
  expect(args.every((arg) => ["a", "b"].includes(arg.where.family_id))).toBe(
    true,
  );
  expect(
    args
      .filter((arg) => arg.data.summary)
      .every(
        (arg) =>
          arg.where.target_type === "member" &&
          arg.where.target_id === "departing" &&
          arg.data.target_id === null,
      ),
  ).toBe(true);
  expect(
    args.some(
      (arg) =>
        arg.where.actor_user_id === "departing" &&
        arg.data.actor_user_id === null,
    ),
  ).toBe(true);
});
