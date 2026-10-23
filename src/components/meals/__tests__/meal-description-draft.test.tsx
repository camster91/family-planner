/** @jest-environment jsdom */
/** Authored for consolidated QA, not device microphone evidence. */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { MealDescriptionDraft } from "../MealDescriptionDraft";
const mockStart = jest.fn(),
  mockStop = jest.fn();
jest.mock("@/components/assistant/use-voice-draft", () => ({
  useVoiceDraft: () => ({
    supported: true,
    listening: false,
    start: mockStart,
    stop: mockStop,
  }),
}));
jest.mock("@/components/assistant/LocalVoiceDraft", () => ({
  LocalVoiceDraft: () => null,
}));
function expand() {
  const element = screen.getByTestId(
    "meal-description-draft",
  ) as HTMLDetailsElement;
  element.open = true;
  fireEvent(element, new Event("toggle"));
}
beforeEach(() => jest.clearAllMocks());
it("shows an explicit proposal and applies only after review, without auto-saving or starting voice", () => {
  const apply = jest.fn();
  render(
    <I18nProvider locale="en">
      <MealDescriptionDraft
        enabled
        contextKey="fixture-owner"
        onApply={apply}
      />
    </I18nProvider>,
  );
  expand();
  fireEvent.change(screen.getByLabelText("Meal description"), {
    target: { value: "Plan tacos for dinner on 2027-10-21 for 4 people" },
  });
  expect(apply).not.toHaveBeenCalled();
  expect(mockStart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use in form" }));
  expect(apply).toHaveBeenCalledWith({
    recipe_name: "tacos",
    date: "2027-10-21",
    meal_type: "dinner",
    servings: 4,
  });
});
it("keeps relative dates manual and disables applying a suspended/locked form", () => {
  const apply = jest.fn();
  const { rerender } = render(
    <I18nProvider locale="es">
      <MealDescriptionDraft
        enabled
        contextKey="fixture-owner"
        onApply={apply}
      />
    </I18nProvider>,
  );
  expand();
  fireEvent.change(screen.getByLabelText("Descripción de la comida"), {
    target: { value: "tacos para mañana" },
  });
  expect(
    screen.queryByRole("button", { name: "Usar en formulario" }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText("Descripción de la comida"), {
    target: { value: "tacos" },
  });
  rerender(
    <I18nProvider locale="es">
      <MealDescriptionDraft
        enabled={false}
        contextKey="fixture-owner"
        onApply={apply}
      />
    </I18nProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Usar en formulario" }),
  ).toBeDisabled();
  expect(apply).not.toHaveBeenCalled();
});
