/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import CommandPaletteHost from "../CommandPaletteHost";

const mockLoad = jest.fn();
jest.mock("../load-command-palette", () => ({
  loadCommandPalette: () => mockLoad(),
}));
jest.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      _params: unknown,
      messages: { en: Record<string, string> },
    ) => messages.en[key],
  }),
}));
function Palette({
  open,
  onClose,
  role,
}: {
  open: boolean;
  onClose: () => void;
  role?: string;
}) {
  return (
    <div data-testid="loaded-palette" hidden={!open}>
      <button onClick={onClose}>Close palette</button>
      {role}
    </div>
  );
}
beforeEach(() => mockLoad.mockReset().mockResolvedValue(Palette));

it("does not download until search opens and retains the loaded palette after closing", async () => {
  render(<CommandPaletteHost role="child" />);
  expect(mockLoad).not.toHaveBeenCalled();
  fireEvent(document, new CustomEvent("open-command-palette"));
  expect(await screen.findByTestId("loaded-palette")).toBeVisible();
  expect(screen.getByTestId("loaded-palette")).toHaveTextContent("child");
  fireEvent.click(screen.getByRole("button", { name: "Close palette" }));
  expect(screen.getByTestId("loaded-palette")).not.toBeVisible();
  fireEvent(document, new CustomEvent("open-command-palette"));
  expect(screen.getAllByTestId("loaded-palette")).toHaveLength(1);
  expect(screen.getByTestId("loaded-palette")).toBeVisible();
  expect(mockLoad).toHaveBeenCalledTimes(1);
});

it("opens before loading and toggles once per Cmd/Ctrl+K, then removes listeners", async () => {
  const { unmount } = render(<CommandPaletteHost role="parent" />);
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  expect(await screen.findByTestId("loaded-palette")).toBeVisible();
  fireEvent.keyDown(document, { key: "K", metaKey: true });
  expect(screen.getByTestId("loaded-palette")).not.toBeVisible();
  unmount();
  const event = new KeyboardEvent("keydown", {
    key: "k",
    ctrlKey: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it("keeps a dismissible loading shell and retries a refused chunk download", async () => {
  mockLoad.mockRejectedValueOnce(new Error("Offline"));
  render(<CommandPaletteHost role="parent" />);
  fireEvent(document, new CustomEvent("open-command-palette"));
  expect(screen.getByRole("status")).toHaveTextContent("Loading search");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load search.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByTestId("loaded-palette")).toBeVisible();
  expect(mockLoad).toHaveBeenCalledTimes(2);
});

it("Escape closes the loading shell before its download finishes", () => {
  mockLoad.mockReturnValue(new Promise(() => undefined));
  render(<CommandPaletteHost role="parent" />);
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
