/** @jest-environment jsdom */
import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import LazyDeleteAccountDialog from "../LazyDeleteAccountDialog";
const mockLoad = jest.fn();
jest.mock("../load-delete-account-dialog", () => ({
  loadDeleteAccountDialog: () => mockLoad(),
}));
beforeEach(() => jest.clearAllMocks());

it("does not download closed controls; a failed download retries without a destructive request", async () => {
  const onClose = jest.fn();
  mockLoad.mockRejectedValueOnce(new Error("fixture chunk failed"));
  let resolve!: (value: () => React.JSX.Element) => void;
  mockLoad.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { rerender } = render(
    <LazyDeleteAccountDialog
      open={false}
      onClose={onClose}
      allowHousehold={false}
    />,
  );
  expect(mockLoad).not.toHaveBeenCalled();
  rerender(
    <LazyDeleteAccountDialog open onClose={onClose} allowHousehold={false} />,
  );
  expect(screen.getByRole("status")).toBeTruthy();
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await act(async () => resolve(() => <p>Fixture account controls</p>));
  expect(screen.getByText("Fixture account controls")).toBeTruthy();
  expect(mockLoad).toHaveBeenCalledTimes(2);
});

it("dismisses a loading dialog with Escape and ignores its late resolution", async () => {
  let resolve!: (value: () => React.JSX.Element) => void;
  const controls = jest.fn(() => <p>Closed fixture controls</p>);
  mockLoad.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const onClose = jest.fn();
  const { rerender } = render(
    <LazyDeleteAccountDialog open onClose={onClose} />,
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  rerender(<LazyDeleteAccountDialog open={false} onClose={onClose} />);
  await act(async () => resolve(controls));
  expect(controls).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});
