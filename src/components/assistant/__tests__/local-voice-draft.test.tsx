/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { LocalVoiceDraft } from "../LocalVoiceDraft";
import { LocalVoice } from "@/lib/local-voice";
jest.mock("@/i18n", () => ({ useTranslation: () => ({ locale: "en" }) }));
jest.mock("@/lib/local-voice", () => {
  const actual = jest.requireActual("@/lib/local-voice");
  return {
    ...actual,
    hasLocalVoice: () => true,
    LocalVoice: {
      availability: jest.fn(),
      listen: jest.fn(),
      cancel: jest.fn(),
    },
  };
});
jest.mock("@capacitor/core", () => ({
  registerPlugin: () => ({}),
  Capacitor: {},
}));
let finish: (value: unknown) => void;
beforeEach(() => {
  jest.clearAllMocks();
  (LocalVoice.availability as jest.Mock).mockResolvedValue({ available: true });
  (LocalVoice.cancel as jest.Mock).mockResolvedValue(undefined);
  (LocalVoice.listen as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});
async function start() {
  fireEvent.click(await screen.findByText("Local voice preview"));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Dictate a draft" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Dictate a draft" }));
}
test("does not request permission or listen until the explicit tap, then offers a draft only", async () => {
  const onDraft = jest.fn();
  render(
    <LocalVoiceDraft
      enabled
      contextKey="fx_actor:list"
      value=""
      onDraft={onDraft}
    />,
  );
  await screen.findByText("Local voice preview");
  expect(LocalVoice.listen).not.toHaveBeenCalled();
  await start();
  await act(async () => finish({ status: "transcript", text: "Fixture milk" }));
  expect(onDraft).toHaveBeenCalledWith("Fixture milk");
  expect(screen.getByRole("status")).toHaveTextContent("Check the words");
});
test("does not overwrite typing that changed while native speech was pending", async () => {
  const onDraft = jest.fn();
  const view = render(
    <LocalVoiceDraft
      enabled
      contextKey="fx_actor:list"
      value=""
      onDraft={onDraft}
    />,
  );
  await start();
  view.rerender(
    <LocalVoiceDraft
      enabled
      contextKey="fx_actor:list"
      value="Fixture typed"
      onDraft={onDraft}
    />,
  );
  await act(async () =>
    finish({ status: "transcript", text: "Fixture spoken" }),
  );
  expect(onDraft).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("Your draft changed");
});
test("actor replacement cancels the exact session and drops its delayed transcript", async () => {
  const onDraft = jest.fn();
  const view = render(
    <LocalVoiceDraft
      enabled
      contextKey="fx_actor_a:list"
      value=""
      onDraft={onDraft}
    />,
  );
  await start();
  const options = (LocalVoice.listen as jest.Mock).mock.calls[0][0];
  view.rerender(
    <LocalVoiceDraft
      enabled
      contextKey="fx_actor_b:list"
      value=""
      onDraft={onDraft}
    />,
  );
  expect(LocalVoice.cancel).toHaveBeenCalledWith({
    requestId: options.requestId,
  });
  await act(async () =>
    finish({ status: "transcript", text: "Fixture speech" }),
  );
  expect(onDraft).not.toHaveBeenCalled();
});
test("hiding the app cancels listening and rejects a late result", async () => {
  const onDraft = jest.fn();
  render(
    <LocalVoiceDraft
      enabled
      contextKey="fx_actor:list"
      value=""
      onDraft={onDraft}
    />,
  );
  await start();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  fireEvent(document, new Event("visibilitychange"));
  await act(async () =>
    finish({ status: "transcript", text: "Fixture background speech" }),
  );
  expect(LocalVoice.cancel).toHaveBeenCalled();
  expect(onDraft).not.toHaveBeenCalled();
});
