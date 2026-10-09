/** @jest-environment jsdom */
import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import LazyNotificationPreferences from "../LazyNotificationPreferences";
const mockLoad = jest.fn();
jest.mock("../load-notification-preferences", () => ({
  loadNotificationPreferences: () => mockLoad(),
}));
beforeEach(() => jest.clearAllMocks());

it("keeps loading accessible, retries a failed optional chunk, and does not reload the page", async () => {
  let resolve!: (component: () => React.JSX.Element) => void;
  mockLoad
    .mockRejectedValueOnce(new Error("isolated chunk failure"))
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  render(<LazyNotificationPreferences />);
  expect(screen.getByRole("status").textContent).toContain("Loading");
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
  await act(async () =>
    resolve(() => (
      <button role="switch" aria-checked="false">
        Fixture preference
      </button>
    )),
  );
  expect(
    screen.getByRole("switch", { name: "Fixture preference" }),
  ).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

it("ignores resolution after the dialog has closed", async () => {
  let resolve!: (component: () => React.JSX.Element) => void;
  const controls = jest.fn(() => <p>Fixture controls</p>);
  mockLoad.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { unmount } = render(<LazyNotificationPreferences />);
  unmount();
  await act(async () => resolve(controls));
  expect(controls).not.toHaveBeenCalled();
});
