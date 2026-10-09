/** @jest-environment jsdom */
import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeleteAccountDialog from "../DeleteAccountDialog";
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

it("preserves an uncertain deletion's retry key after closing and reopening the loaded dialog", async () => {
  mockLoad.mockResolvedValue(DeleteAccountDialog);
  const keys: string[] = [];
  global.fetch = jest.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        keys.push((init.headers as Record<string, string>)["Idempotency-Key"]);
        if (keys.length < 3) throw new TypeError("isolated dropped connection");
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: "Unauthorized" }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          role: "child",
          household: {
            id: "fixture",
            name: "Fixture",
            memberCount: 3,
            parentCount: 1,
          },
          isOnlyParent: false,
          canDeleteAccount: true,
          canDeleteHousehold: false,
        }),
      } as Response;
    },
  ) as typeof fetch;
  const onDeleted = jest.fn();
  const props = { onClose: jest.fn(), onDeleted, allowHousehold: false };
  const { rerender } = render(<LazyDeleteAccountDialog open {...props} />);
  await userEvent.type(
    await screen.findByLabelText("Your password"),
    "fixture-password",
  );
  await userEvent.type(screen.getByLabelText(/to confirm/), "DELETE");
  await userEvent.click(
    screen.getByRole("button", { name: "Delete my account" }),
  );
  await screen.findByRole("alert");
  expect(keys).toHaveLength(2);
  rerender(<LazyDeleteAccountDialog open={false} {...props} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(<LazyDeleteAccountDialog open {...props} />);
  await userEvent.type(
    await screen.findByLabelText("Your password"),
    "fixture-password",
  );
  await userEvent.type(screen.getByLabelText(/to confirm/), "DELETE");
  await userEvent.click(
    screen.getByRole("button", { name: "Delete my account" }),
  );
  await waitFor(() => expect(keys).toHaveLength(3));
  expect(new Set(keys).size).toBe(1);
  expect(onDeleted).toHaveBeenCalledWith("account");
  expect(mockLoad).toHaveBeenCalledTimes(1);
});
