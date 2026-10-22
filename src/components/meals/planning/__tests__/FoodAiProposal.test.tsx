/** Authored/unrun. Explicit callbacks, no write actions or provider prose. */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { FoodAiProposal } from "../FoodAiProposal";
import { aiFixture } from "@/lib/food-planning/__tests__/ai-fixture";
import { FOOD_AI, foodAiSuggestion } from "@/lib/food-planning/ai-contract";
import { evaluateFoodAiProposal } from "@/lib/food-planning/ai-evaluation";
jest.mock("@/i18n", () => ({ useTranslation: () => ({ locale: "en" }) }));
function suggestion() {
  const { original, proposal } = aiFixture();
  return foodAiSuggestion.parse({
    protocol: FOOD_AI,
    original,
    proposal,
    evidence: [
      {
        key: "dinner",
        recipeId: "recipe-b",
        ref: `frc1_${"a".repeat(64)}`,
        label: "Synthetic b",
        source: "household-recipe",
      },
    ],
    evaluation: evaluateFoodAiProposal(original, proposal),
  });
}
beforeEach(() =>
  jest.useFakeTimers().setSystemTime(new Date("2026-10-22T12:00:00Z")),
);
afterEach(() => jest.useRealTimers());
it("requires an explicit choice and explains the separate save review", () => {
  const use = jest.fn(),
    dismiss = jest.fn();
  render(
    <FoodAiProposal
      suggestion={suggestion()}
      busy={false}
      onUse={use}
      onDismiss={dismiss}
    />,
  );
  expect(use).not.toHaveBeenCalled();
  expect(dismiss).not.toHaveBeenCalled();
  expect(
    screen.getByText(/Save still needs your separate review/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /confirm|save/i }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Use these choices" }));
  expect(use).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Keep my choices" }));
  expect(dismiss).toHaveBeenCalledTimes(1);
});
it("holds both decisions during owned storage, authority or another active operation", () => {
  render(
    <FoodAiProposal
      suggestion={suggestion()}
      busy
      onUse={jest.fn()}
      onDismiss={jest.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Use these choices" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Keep my choices" }),
  ).toBeDisabled();
});

it("expires locally without a provider call or draft mutation and leaves dismissal usable", () => {
  const use = jest.fn(),
    dismiss = jest.fn();
  render(
    <FoodAiProposal
      suggestion={suggestion()}
      busy={false}
      onUse={use}
      onDismiss={dismiss}
    />,
  );
  act(() => jest.advanceTimersByTime(60000));
  expect(
    screen.getByRole("button", { name: "Use these choices" }),
  ).toBeDisabled();
  expect(screen.getByText(/These choices expired/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Keep my choices" })).toBeEnabled();
  expect(use).not.toHaveBeenCalled();
  expect(dismiss).not.toHaveBeenCalled();
});
