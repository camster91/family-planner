/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { FoodDescriptionDraft } from "../FoodDescriptionDraft";
const mockStop = jest.fn(),
  mockStart = jest.fn();
let mockTranscript: (text: string) => void;
jest.mock("@/components/assistant/use-voice-draft", () => ({
  useVoiceDraft: (_enabled: boolean, onText: (text: string) => void) => {
    mockTranscript = onText;
    return {
      supported: true,
      listening: false,
      stop: mockStop,
      start: mockStart,
    };
  },
}));
jest.mock("@/components/assistant/LocalVoiceDraft", () => ({
  LocalVoiceDraft: () => null,
}));
beforeEach(() => jest.clearAllMocks());
function expand() {
  const details = screen.getByTestId(
    "food-description-draft",
  ) as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}
it("requires explicit apply and never requests voice on opening", () => {
  const apply = jest.fn();
  render(
    <I18nProvider locale="en">
      <FoodDescriptionDraft
        enabled
        contextKey="fixture-owner"
        onApply={apply}
      />
    </I18nProvider>,
  );
  expand();
  fireEvent.change(screen.getByLabelText("Food description"), {
    target: { value: "Add 2 cans of beans to the pantry" },
  });
  expect(mockStart).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Use in form"));
  expect(apply).toHaveBeenCalledWith({
    name: "beans",
    amount: 2,
    unit: "cans",
    location: "pantry",
  });
});
it("does not replace text typed while a speech result was pending", () => {
  render(
    <I18nProvider locale="en">
      <FoodDescriptionDraft
        enabled
        contextKey="fixture-owner"
        onApply={jest.fn()}
      />
    </I18nProvider>,
  );
  expand();
  fireEvent.click(screen.getByRole("button", { name: "Dictate description" }));
  fireEvent.change(screen.getByLabelText("Food description"), {
    target: { value: "keep this new draft" },
  });
  act(() => mockTranscript("late speech must not replace typed text"));
  expect(screen.getByLabelText("Food description")).toHaveValue(
    "keep this new draft",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Your description changed while listening",
  );
  expect(mockStart).toHaveBeenCalledTimes(1);
});
it("keeps unsupported dates manual and disables applying while the owner/form is suspended", () => {
  const apply = jest.fn();
  const { rerender } = render(
    <I18nProvider locale="es">
      <FoodDescriptionDraft
        enabled
        contextKey="fixture-owner"
        onApply={apply}
      />
    </I18nProvider>,
  );
  expand();
  fireEvent.change(screen.getByLabelText("Descripción del alimento"), {
    target: { value: "leche caduca mañana" },
  });
  expect(
    screen.queryByRole("button", { name: "Usar en formulario" }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText("Descripción del alimento"), {
    target: { value: "dos latas de frijoles" },
  });
  rerender(
    <I18nProvider locale="es">
      <FoodDescriptionDraft
        enabled={false}
        contextKey="fixture-owner"
        onApply={apply}
      />
    </I18nProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Usar en formulario", hidden: true }),
  ).toBeDisabled();
  expect(apply).not.toHaveBeenCalled();
});
