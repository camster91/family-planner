/** Authored/unrun. Untrusted DTO and exact source-query matching, no HTTP. */
jest.mock("../../owned-request-http", () => ({ requestOwnedJson: jest.fn() }));
import { requestOwnedJson } from "../../owned-request-http";
import { foodPreviewView, foodReviewView } from "../view-contract";
import { readFoodPreview, readFoodWriteReview } from "../client";
import { context, makeCommand } from "./recovery-fixture";
import { makePreview, makeReview } from "./view-fixture";
const reply = (body: unknown) => ({
  kind: "reply" as const,
  response: { status: 200, ok: true } as Response,
  body,
});
afterEach(() => jest.clearAllMocks());
it("requires complete nested source fields and refuses altered labels/amount types and fabricated writes", () => {
  const view = makePreview();
  expect(foodPreviewView.safeParse(view).success).toBe(true);
  expect(
    foodPreviewView.safeParse({
      ...view,
      plan: { ...view.plan, writesPerformed: true },
    }).success,
  ).toBe(false);
  expect(
    foodPreviewView.safeParse({
      ...view,
      plan: {
        ...view.plan,
        slots: [
          {
            ...view.plan.slots[0],
            choice: {
              ...view.plan.slots[0].choice!,
              title: { unsafe: "object" },
            },
          },
        ],
      },
    }).success,
  ).toBe(false);
  expect(
    foodPreviewView.safeParse({
      ...view,
      owner: { ...view.owner, privateField: "not projected" },
    }).success,
  ).toBe(false);
});
it("refuses a different household/generation or an echoed query for another date even when keys match", async () => {
  const view = makePreview();
  for (const changed of [
    { ...view, owner: { ...view.owner, familyId: "other-family" } },
    { ...view, owner: { ...view.owner, generation: 1 } },
    {
      ...view,
      sourceRequest: {
        ...view.sourceRequest,
        plan: {
          ...view.sourceRequest.plan,
          slots: view.sourceRequest.plan.slots.map((slot) => ({
            ...slot,
            date: "2026-10-23",
          })),
        },
      },
    },
  ]) {
    jest.mocked(requestOwnedJson).mockResolvedValueOnce(reply(changed));
    await expect(
      readFoodPreview(view.sourceRequest, context()),
    ).rejects.toThrow();
  }
  jest
    .mocked(requestOwnedJson)
    .mockResolvedValueOnce(reply(view))
    .mockResolvedValueOnce(reply(context()));
  expect((await readFoodPreview(view.sourceRequest, context())).plan).toEqual(
    view.plan,
  );
});
it("requires the exact reviewed command and corresponding plan before rendering a confirmation", async () => {
  const view = makeReview();
  expect(foodReviewView.safeParse(view).success).toBe(true);
  const command = makeCommand();
  if (command.mode !== "meals") throw new Error("fixture");
  const changed = {
    ...view,
    input: {
      ...command,
      meals: [
        {
          ...command.meals[0],
          input: { ...command.meals[0].input, notes: "unexpected edit" },
        },
      ],
    },
  };
  jest.mocked(requestOwnedJson).mockResolvedValueOnce(reply(changed));
  await expect(readFoodWriteReview(command, context())).rejects.toThrow();
  expect(
    foodReviewView.safeParse({
      ...view,
      plan: {
        ...view.plan,
        slots: [{ ...view.plan.slots[0], holds: ["calendar-unknown"] }],
      },
    }).success,
  ).toBe(false);
  expect(
    foodReviewView.safeParse({
      ...view,
      people: [{ id: "unselected-person", name: "Unexpected", role: "parent" }],
    }).success,
  ).toBe(false);
});

it("suppresses a delayed private read after the original person scope changes", async () => {
  const view = makePreview(),
    current = context();
  jest
    .mocked(requestOwnedJson)
    .mockResolvedValueOnce(reply(view))
    .mockResolvedValueOnce(
      reply({
        ...current,
        familyId: "other-family",
        owner: {
          ...current.owner!,
          scope: "d".repeat(64),
          householdScope: "e".repeat(64),
        },
      }),
    );
  await expect(readFoodPreview(view.sourceRequest, current)).rejects.toThrow();
});
