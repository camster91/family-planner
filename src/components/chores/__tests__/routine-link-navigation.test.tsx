/** @jest-environment jsdom */
import * as React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { useRoutineLinkNavigation } from "../useRoutineLinkNavigation";

function Harness({
  active = true,
  navigate,
}: {
  active?: boolean;
  navigate: (href: string) => Promise<void>;
}) {
  useRoutineLinkNavigation(active, navigate);
  return <a href="/dashboard/chores?view=routines">Return</a>;
}
function click(anchor: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  anchor.dispatchEvent(event);
  return event;
}

it("holds sidebar links while preparation is pending and navigates only once", async () => {
  let finish!: () => void;
  const navigate = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const screen = render(<Harness navigate={navigate} />);
  // The sidebar is outside the editor subtree.
  const sidebar = document.createElement("a");
  sidebar.href = "/dashboard/calendar";
  document.body.append(sidebar);
  try {
    expect(click(sidebar).defaultPrevented).toBe(true);
    expect(click(screen.getByText("Return")).defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/dashboard/calendar");
    await act(async () => {
      finish();
    });
    fireEvent.click(screen.getByText("Return"));
    expect(navigate).toHaveBeenCalledTimes(2);
    await act(async () => {
      finish();
    });
  } finally {
    sidebar.remove();
  }
});

it("keeps a failed preparation on the current page and permits explicit retry", async () => {
  const navigate = jest
    .fn()
    .mockRejectedValue(new Error("storage unavailable"));
  const screen = render(<Harness navigate={navigate} />);
  await act(async () => {
    expect(click(screen.getByText("Return")).defaultPrevented).toBe(true);
  });
  await act(async () => {
    click(screen.getByText("Return"));
  });
  expect(navigate).toHaveBeenCalledTimes(2);
});

it("preserves modified clicks, downloads, other windows, fragments and foreign links", () => {
  const navigate = jest.fn(async () => {});
  const screen = render(<Harness navigate={navigate} />);
  const anchor = screen.getByText("Return") as HTMLAnchorElement;
  // Stop the default jsdom navigation after the document capture listener.
  anchor.addEventListener("click", (event) => event.preventDefault());
  for (const init of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])
    click(anchor, init);
  anchor.target = "_blank";
  click(anchor);
  anchor.target = "";
  anchor.download = "file";
  click(anchor);
  anchor.removeAttribute("download");
  anchor.href = "https://example.com/dashboard";
  click(anchor);
  anchor.href = window.location.pathname + window.location.search + "#details";
  click(anchor);
  anchor.href = "/login";
  click(anchor);
  expect(navigate).not.toHaveBeenCalled();
});

it("uses current protection state and removes capture handling on unmount", () => {
  const navigate = jest.fn(async () => {});
  const screen = render(<Harness active={false} navigate={navigate} />);
  const anchor = screen.getByText("Return");
  anchor.addEventListener("click", (event) => event.preventDefault());
  click(anchor);
  expect(navigate).not.toHaveBeenCalled();
  screen.rerender(<Harness navigate={navigate} />);
  click(anchor);
  expect(navigate).toHaveBeenCalledTimes(1);
  screen.unmount();
  const sidebar = document.createElement("a");
  sidebar.href = "/dashboard/calendar";
  sidebar.addEventListener("click", (event) => event.preventDefault());
  document.body.append(sidebar);
  click(sidebar);
  expect(navigate).toHaveBeenCalledTimes(1);
  sidebar.remove();
});
