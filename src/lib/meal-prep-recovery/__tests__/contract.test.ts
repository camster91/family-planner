/** Authored/unrun. Strict boundaries and exact receipt semantics. */
import {
  PREP_RECOVERY,
  prepCommand,
  prepReceiptMatches,
  prepRecoveryInput,
  prepMatchesContext,
} from "../contract";
import {
  prepDraftPayload,
  prepDraftEntry,
  prepJournal,
  prepJournalMatchesContext,
} from "../draft-contract";
import { command, context, entry, receipt } from "./fixture";
it("requires the exact target/action receipt and refuses missing, extra or duplicated IDs", () => {
  expect(prepReceiptMatches(receipt(), command())).toBe(true);
  for (const value of [
    { ...receipt(), batchId: "foreign-batch" },
    { ...receipt(), mealIds: [] },
    { ...receipt(), mealIds: ["meal-a", "meal-a"] },
    { sessionId: "prep-a" },
    { ...receipt(), privateField: "not projected" },
  ])
    expect(prepReceiptMatches(value, command())).toBe(false);
});
it("separates original user/household/role/generation from a current authorized actor", () => {
  expect(prepMatchesContext(entry(), context())).toBe(true);
  for (const changed of [
    { ...context(), familyId: "family-b" },
    { ...context(), role: "teen" as const },
    { ...context(), owner: { ...context().owner!, generation: 3 } },
  ])
    expect(prepMatchesContext(entry(), changed)).toBe(false);
});
it("keeps incomplete drafts local, strictly scoped, and unsendable", () => {
  const payload = prepDraftPayload.parse({
    userId: "parent-a",
    familyId: "family-a",
    role: "parent",
    generation: 2,
    draft: {
      kind: "create",
      day: "",
      nextDay: "",
      dishes: [
        {
          name: "",
          portions: "",
          recipe: null,
          cookId: "",
          storage: "freezer",
          meals: [],
        },
      ],
      step: 0,
      selectedDish: 0,
    },
  });
  const local = prepDraftEntry.parse({
    kind: "local-prep-draft",
    key: entry().key,
    body: JSON.stringify(payload),
  });
  expect(prepJournalMatchesContext(local, context())).toBe(true);
  expect(prepJournalMatchesContext(local, { ...context(), role: "teen" })).toBe(
    false,
  );
  expect(
    prepRecoveryInput.safeParse({ contract: PREP_RECOVERY, entry: local })
      .success,
  ).toBe(false);
  expect(
    prepJournal.safeParse({
      contract: PREP_RECOVERY,
      entries: [local, { ...local, key: "second_local_draft_1234" }],
    }).success,
  ).toBe(false);
  expect(
    prepCommand.safeParse({ ...command(), url: "/api/arbitrary" }).success,
  ).toBe(false);
});
