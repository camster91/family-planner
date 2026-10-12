/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const back = jest.fn();
const push = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ back, push, refresh }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => true,
}));
import { FormSheet, ListCreateSheet } from "../DashboardFormSheets";
import {
  usePendingFormNavigationController,
  type PendingFormNavigation,
} from "../pending-form-navigation";

beforeEach(() => {
  back.mockReset();
  push.mockReset();
  refresh.mockReset();
});

it("returns through history, restores focus, scrolling and background interaction", async () => {
  const user = userEvent.setup();
  function Journey() {
    const [open, setOpen] = React.useState(false);
    back.mockImplementation(() => setOpen(false));
    return (
      <>
        <div data-dashboard-background>
          <button onClick={() => setOpen(true)}>New list</button>
        </div>
        {open && (
          <FormSheet title="New List">
            <input aria-label="Draft" />
          </FormSheet>
        )}
      </>
    );
  }
  document.body.style.overflow = "auto";
  const { container } = render(<Journey />);
  const opener = screen.getByRole("button", { name: "New list" });
  await user.click(opener);
  const background = container.querySelector<HTMLElement>(
    "[data-dashboard-background]",
  )!;
  expect(background.inert).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
  expect(screen.getByRole("dialog", { name: "New List" })).toHaveAttribute(
    "aria-modal",
    "true",
  );
  expect(
    screen.getByRole("button", { name: "Close and return" }),
  ).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(back).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(background.inert).toBe(false);
  expect(document.body.style.overflow).toBe("auto");
  expect(opener).toHaveFocus();
  document.body.style.overflow = "";
});

it("clears the actual list draft on close and fresh reopen without sending a mutation", async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn();
  function Journey() {
    const [open, setOpen] = React.useState(false);
    back.mockImplementation(() => setOpen(false));
    return (
      <>
        <div data-dashboard-background>
          <button onClick={() => setOpen(true)}>Add list</button>
        </div>
        {open && <ListCreateSheet />}
      </>
    );
  }
  render(<Journey />);
  await user.click(screen.getByRole("button", { name: "Add list" }));
  await user.type(screen.getByLabelText("Name"), "Packing draft");
  expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Close and return" }));
  await user.click(screen.getByRole("button", { name: "Add list" }));
  expect(screen.getByLabelText("Name")).toHaveValue("");
  expect(fetch).not.toHaveBeenCalled();
});

it("passes the list role boundary into the intercepted sheet", () => {
  render(<ListCreateSheet canCreate={false} />);
  expect(screen.getByTestId("list-create-refused")).toBeInTheDocument();
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
});

it("does not dismiss the actual list sheet during save, then permits retry and close after failure", async () => {
  const user = userEvent.setup();
  let finish!: (r: Response) => void;
  global.fetch = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  render(<ListCreateSheet />);
  await user.type(screen.getByLabelText("Name"), "Camping");
  await user.click(screen.getByRole("button", { name: /Create List/ }));
  expect(
    screen.queryByRole("button", { name: "Close and return" }),
  ).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(back).not.toHaveBeenCalled();
  await act(async () =>
    finish({
      ok: false,
      json: async () => ({ error: "Try again" }),
    } as Response),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Try again");
  await user.click(screen.getByRole("button", { name: "Close and return" }));
  expect(back).toHaveBeenCalledTimes(1);
});

it("does not dismiss during an image upload and unlocks after upload failure", async () => {
  const user = userEvent.setup();
  let finish!: (r: Response) => void;
  global.fetch = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const { container } = render(<ListCreateSheet />);
  await user.click(container.querySelector("summary")!);
  await user.upload(
    screen.getByLabelText("Choose list image"),
    new File(["fixture"], "cover.jpg", { type: "image/jpeg" }),
  );
  await user.keyboard("{Escape}");
  expect(back).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Close and return" }),
  ).not.toBeInTheDocument();
  await act(async () =>
    finish({
      ok: false,
      json: async () => ({ error: "Upload failed" }),
    } as Response),
  );
  expect(
    screen.getByRole("button", { name: "Close and return" }),
  ).toBeInTheDocument();
});

it("owns a same-URL sentinel, blocks Back while busy, and releases once", async () => {
  const originalUrl = window.location.href;
  window.history.replaceState({ route: "base" }, "", "/dashboard/lists");
  window.history.pushState({ route: "form" }, "", "/dashboard/lists/create");
  const view = render(
    <FormSheet title="Saving list" busy>
      <button>Saving</button>
    </FormSheet>,
  );

  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);

  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(window.location.pathname).toBe("/dashboard/lists/create");
  expect(window.history.state).toEqual(
    expect.objectContaining({ route: "form" }),
  );
  const sentinelLength = window.history.length;

  view.rerender(
    <FormSheet title="Saving list" busy={false}>
      <button>Saving</button>
    </FormSheet>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(window.location.pathname).toBe("/dashboard/lists/create");
  expect(window.history.length).toBe(sentinelLength);

  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(window.location.pathname).toBe("/dashboard/lists");
  view.unmount();
  window.history.replaceState({}, "", originalUrl);
});

it("retains a pre-existing inert background and scroll lock on external unmount", () => {
  const background = document.createElement("div");
  background.setAttribute("data-dashboard-background", "");
  background.inert = true;
  document.body.appendChild(background);
  document.body.style.overflow = "hidden";
  const view = render(
    <FormSheet title="New Chore" busy>
      <button>Saving</button>
    </FormSheet>,
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(back).not.toHaveBeenCalled();
  view.unmount();
  expect(background.inert).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
  background.remove();
  document.body.style.overflow = "";
});

it("does not consume the real prior page when Back already consumed the sentinel", async () => {
  const original = window.location.href;
  const baseState = { __NA: true, route: "form" };
  window.history.replaceState(baseState, "", "/dashboard/lists/create");
  let navigation!: PendingFormNavigation;
  function Harness() {
    navigation = usePendingFormNavigationController(true);
    return null;
  }
  const view = render(<Harness />);
  expect(window.history.state.__herewovenPendingForm).toEqual(
    expect.any(String),
  );
  // Same URL and same history length, but this is the base entry reached by
  // Back rather than the marked sentinel. Release must not traverse again.
  window.history.replaceState(baseState, "", window.location.href);
  const historyBack = jest
    .spyOn(window.history, "back")
    .mockImplementation(() => {});
  try {
    await navigation.releaseBeforeNavigation();
    expect(historyBack).not.toHaveBeenCalled();
    expect(window.history.state).toEqual(baseState);
  } finally {
    view.unmount();
    historyBack.mockRestore();
    window.history.replaceState({}, "", original);
  }
});

it("serializes release after pending Back restoration before consuming the owned entry", async () => {
  const original = window.location.href;
  const baseState = { __NA: true, route: "form" };
  window.history.replaceState(baseState, "", "/dashboard/lists/create");
  let navigation!: PendingFormNavigation;
  function Harness() {
    navigation = usePendingFormNavigationController(true);
    return null;
  }
  const view = render(<Harness />);
  const sentinelState = window.history.state;
  const historyBack = jest
    .spyOn(window.history, "back")
    .mockImplementation(() => {});
  const historyForward = jest
    .spyOn(window.history, "forward")
    .mockImplementation(() => {});
  try {
    window.history.replaceState(baseState, "", window.location.href);
    window.dispatchEvent(new PopStateEvent("popstate", { state: baseState }));
    expect(historyForward).toHaveBeenCalledTimes(1);
    const release = navigation.releaseBeforeNavigation();
    expect(historyBack).not.toHaveBeenCalled();
    window.history.replaceState(sentinelState, "", window.location.href);
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: sentinelState }),
    );
    expect(historyBack).toHaveBeenCalledTimes(1);
    window.history.replaceState(baseState, "", window.location.href);
    window.dispatchEvent(new PopStateEvent("popstate", { state: baseState }));
    await release;
    expect(historyBack).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    historyBack.mockRestore();
    historyForward.mockRestore();
    window.history.replaceState({}, "", original);
  }
});
