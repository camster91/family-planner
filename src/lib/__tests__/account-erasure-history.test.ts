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
    householdDevice: { findMany: jest.fn().mockResolvedValue([{ family_id: "d" }]) },
    devicePairing: { findMany: jest.fn().mockResolvedValue([{ family_id: "c" }]) },
    familyInvite: { findMany: jest.fn().mockResolvedValue([{ family_id: "e" }]) },
  } as unknown as Prisma.TransactionClient;
  expect(await accountErasureHistoryHouseholds(tx, "departing")).toEqual([
    "a",
    "b",
    "c",
    "d",
    "e",
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
    householdDevice: { updateMany: jest.fn() },
    devicePairing: { updateMany: jest.fn(), deleteMany: jest.fn() },
    familyInvite: { deleteMany: jest.fn() },
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

it("clears exact device actor slots and the full erased elevation only in locked households", async () => {
  const devices = jest.fn(), pairings = jest.fn();
  const tx = {
    auditLog: { updateMany: jest.fn() }, $executeRaw: jest.fn(),
    householdDevice: { updateMany: devices }, devicePairing: { updateMany: pairings, deleteMany: jest.fn() },
    familyInvite: { deleteMany: jest.fn() },
  } as unknown as Prisma.TransactionClient;
  await eraseRetainedAccountHistoryInTx(tx, { id: "departing", role: "parent" }, ["old", "current"]);
  expect(pairings.mock.calls.map(([arg]) => arg)).toEqual([
    { where: { family_id: "current", confirmed_by: "departing" }, data: { confirmed_by: null } },
    { where: { family_id: "old", confirmed_by: "departing" }, data: { confirmed_by: null } },
  ]);
  const calls = devices.mock.calls.map(([arg]) => arg);
  expect(calls).toHaveLength(8);
  expect(calls.every(arg => ["current", "old"].includes(arg.where.family_id))).toBe(true);
  for (const column of ["created_by", "confirmed_by", "revoked_by"]) {
    const edits = calls.filter(arg => arg.where[column] === "departing");
    expect(edits).toHaveLength(2);
    expect(edits.every(arg => JSON.stringify(arg.data) === JSON.stringify({ [column]: null }))).toBe(true);
  }
  expect(calls.filter(arg => arg.where.elevated_user_id === "departing").map(arg => arg.data)).toEqual([0, 1].map(() => ({
    elevation_token_hash: null, elevated_user_id: null, elevated_token_version: null,
    elevation_method: null, elevation_started_at: null, elevation_last_used_at: null, elevation_expires_at: null,
  })));
});

it("removes creator-owned invitation and pairing requests only from the supplied locked households", async () => {
  const invites = jest.fn(), pairings = jest.fn();
  const tx = {
    auditLog: { updateMany: jest.fn() }, $executeRaw: jest.fn(),
    householdDevice: { updateMany: jest.fn() },
    devicePairing: { updateMany: jest.fn(), deleteMany: pairings },
    familyInvite: { deleteMany: invites },
  } as unknown as Prisma.TransactionClient;
  await eraseRetainedAccountHistoryInTx(tx, { id: "departing", role: "parent" }, ["old", "current", "old"]);
  const expected = ["current", "old"].map(family_id => [{ where: { family_id, created_by: "departing" } }]);
  expect(invites.mock.calls).toEqual(expected);
  expect(pairings.mock.calls).toEqual(expected);
});
