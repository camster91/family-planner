/** Authored only. Execute with the consolidated QA candidate. */
import {
  navigateAfterOwnedDrafts,
  registerOwnedDraftExit,
  type OwnedDraftExit,
} from "../owned-draft-exit";
const cleanups: Array<() => void> = [];
function register(overrides: Partial<OwnedDraftExit> = {}) {
  const owner = {
    active: () => true,
    prepare: jest.fn(async () => true),
    release: jest.fn(async () => true),
    ...overrides,
  };
  cleanups.push(registerOwnedDraftExit(owner));
  return owner;
}
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
it("preserves immediate ordinary navigation without an active editor", async () => {
  register({ active: () => false });
  const navigate = jest.fn();
  const result = navigateAfterOwnedDrafts(navigate);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(await result).toBe(true);
});
it("prepares every active editor before releasing any history or navigating", async () => {
  const calls: string[] = [];
  for (const label of ["outer", "inner"])
    register({
      prepare: async () => {
        calls.push(`save:${label}`);
        return true;
      },
      release: async () => {
        calls.push(`release:${label}`);
        return true;
      },
    });
  expect(await navigateAfterOwnedDrafts(() => calls.push("navigate"))).toBe(
    true,
  );
  expect(calls).toEqual([
    "save:inner",
    "save:outer",
    "release:inner",
    "release:outer",
    "navigate",
  ]);
});
it("keeps all history intact on failed preparation and suppresses repeated navigation", async () => {
  let finish!: (value: boolean) => void;
  const owner = register({
    prepare: jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    ),
  });
  const navigate = jest.fn();
  const first = navigateAfterOwnedDrafts(navigate);
  expect(await navigateAfterOwnedDrafts(navigate)).toBe(false);
  finish(false);
  expect(await first).toBe(false);
  expect(owner.release).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});
it("refuses a superseded owner and never falls through after a failed history release", async () => {
  let finish!: (value: boolean) => void;
  const owner = register({
    prepare: () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  });
  const navigate = jest.fn();
  const pending = navigateAfterOwnedDrafts(navigate);
  cleanups.pop()!();
  finish(true);
  expect(await pending).toBe(false);
  expect(owner.release).not.toHaveBeenCalled();
  register({ release: async () => false });
  expect(await navigateAfterOwnedDrafts(navigate)).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
});
it("lets an approved host callback call its router without recursively saving again", async () => {
  const owner = register();
  const navigate = jest.fn();
  let nested!: Promise<boolean>;
  expect(
    await navigateAfterOwnedDrafts(() => {
      nested = navigateAfterOwnedDrafts(navigate);
    }),
  ).toBe(true);
  expect(await nested).toBe(true);
  expect(owner.prepare).toHaveBeenCalledTimes(1);
  expect(owner.release).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledTimes(1);
});
