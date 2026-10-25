// Authored UNRUN. Frozen payload/strict path and explicit read contract only.
jest.mock("../owned-request-http", () => ({ requestOwnedJson: jest.fn() }));
import { requestOwnedJson } from "../owned-request-http";
import { makeOwnedChoreCheckIntent, sendOwnedChoreCheck, readOwnedChoreCheck } from "../chore-check-command-client";
import { CHORE_CHECK_COMMAND_PROTOCOL, CHORE_CHECK_OWNER_HEADER } from "../chore-check-command-shared";
const request = jest.mocked(requestOwnedJson);
const owner = { userId: "fixture-parent", familyId: "fixture-family", role: "parent" as const, generation: 2 };
const expected = { generation: "5b58743a-1f01-40fe-adb1-4628148495cb", materialEpoch: 2, completionEpoch: 7 };
const command = { protocol: CHORE_CHECK_COMMAND_PROTOCOL, owner, choreId: "fixture-chore", expected, decision: "reject" as const, verificationNotes: "Original note" };
beforeEach(() => request.mockReset());
it("keeps the exact original body/version/note on retry without a legacy endpoint call", async () => {
  const draft = { ...command, owner: { ...owner }, expected: { ...expected } };
  const intent = makeOwnedChoreCheckIntent(draft);
  draft.verificationNotes = "New note"; draft.expected.completionEpoch = 9;
  request.mockResolvedValue({ kind: "unknown" });
  await sendOwnedChoreCheck(intent); await sendOwnedChoreCheck(intent);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.every(call => call[0] === "/api/chores/verify/owned")).toBe(true);
  expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body);
  expect(JSON.parse(intent.body)).toMatchObject({ expected, verificationNotes: "Original note" });
});
it("does not treat missing/foreign/malformed receipt state as accepted", async () => {
  const intent = makeOwnedChoreCheckIntent(command);
  request.mockResolvedValue({ kind: "reply", response: { ok: true, status: 200 }, body: { success: true } } as any);
  expect(await sendOwnedChoreCheck(intent)).toEqual({ kind: "unknown" });
  request.mockResolvedValue({ kind: "reply", response: { ok: true, status: 200 }, body: { success: true, chore: { id: "foreign" } } } as any);
  expect(await sendOwnedChoreCheck(intent)).toEqual({ kind: "unknown" });
});
it("binds explicit current-state reads to matching owner and source version", async () => {
  const chore = { id: command.choreId, family_id: owner.familyId, title: "Fixture", status: "completed", responsibility_generation: expected.generation, responsibility_epoch: 2, preparation_epoch: 9 };
  request.mockResolvedValue({ kind: "reply", response: { ok: true }, body: { protocol: CHORE_CHECK_COMMAND_PROTOCOL, owner, chore, version: { ...expected, completionEpoch: 9 } } } as any);
  expect(await readOwnedChoreCheck(owner, command.choreId)).toMatchObject({ kind: "current", version: { completionEpoch: 9 } });
  expect(request.mock.calls[0][1].headers).toEqual({ [CHORE_CHECK_OWNER_HEADER]: JSON.stringify(owner), "X-Member-Protocol": "2" });
  request.mockResolvedValue({ kind: "reply", response: { ok: true }, body: { protocol: CHORE_CHECK_COMMAND_PROTOCOL, owner: { ...owner, generation: 3 }, chore, version: expected } } as any);
  expect(await readOwnedChoreCheck(owner, command.choreId)).toEqual({ kind: "held", code: "CHORE_CHECK_OWNER_CHANGED" });
});

it("masks access loss independently of a server error body's code", async () => {
  request.mockResolvedValue({ kind: "reply", response: { ok: false, status: 401 }, body: { error: "Unauthorized" } } as any);
  expect(await sendOwnedChoreCheck(makeOwnedChoreCheckIntent(command))).toEqual({ kind: "held", code: "CHORE_CHECK_OWNER_CHANGED" });
  expect(await readOwnedChoreCheck(owner, command.choreId)).toEqual({ kind: "held", code: "CHORE_CHECK_OWNER_CHANGED" });
});
