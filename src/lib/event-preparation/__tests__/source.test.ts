/** Source cases authored/unrun; no schema, DB or household operation executed. */
import { preparationTaskToken } from "../source";
import { preparationStateToken } from "../state-store";
import { scopeForPreparationCommand } from "../read-contract";
import { preparationTestFixture } from "./test-fixture";
const source = {
  generation: "22acfa09-9174-4de0-844f-2190415054f0",
  epoch: 1,
  preparationEpoch: 0,
};
it("separates proof/completion continuity from canonical material generation/epoch", () => {
  const initial = preparationTaskToken("family-a", "chore-a", source);
  expect(
    preparationTaskToken("family-a", "chore-a", {
      ...source,
      preparationEpoch: 2,
    }),
  ).not.toBe(initial);
  expect(
    preparationTaskToken("family-a", "chore-a", { ...source, epoch: 2 }),
  ).not.toBe(initial);
  expect(preparationTaskToken("family-b", "chore-a", source)).not.toBe(initial);
  expect(() =>
    preparationTaskToken("family-a", "chore-a", {
      ...source,
      preparationEpoch: 2147483647,
    }),
  ).toThrow();
});
it("binds exact link-row identity even if visible membership and cue are recreated", () => {
  const state = {
    id: "plan-a",
    revision: 1,
    reviewedEventSourceToken: "a".repeat(64),
    links: [{ id: "link-a", choreId: "chore-a", position: 1, cue: null }],
  };
  expect(
    preparationStateToken({
      ...state,
      links: [{ ...state.links[0], id: "link-b" }],
    }),
  ).not.toBe(preparationStateToken(state));
});
it("derives only the exact command selection and keeps profile subjects separate from actors", () => {
  const { command } = preparationTestFixture();
  const selection = scopeForPreparationCommand(command);
  expect(selection).toEqual({
    eventId: "event-a",
    memberProtocol: 2,
    timeZone: "America/Toronto",
    choreIds: [],
    subjects: [{ kind: "account", accountId: "parent-a" }],
    routine: null,
  });
  expect(selection).not.toHaveProperty("userId");
});
