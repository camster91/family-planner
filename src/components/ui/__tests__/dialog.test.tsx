/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "../dialog";

function InitiallyNested({ dismissible = true }: { dismissible?: boolean }) {
  const [outer, setOuter] = React.useState(false);
  const [inner, setInner] = React.useState(true);
  return (
    <>
      <button
        onClick={() => {
          setOuter(true);
          setInner(true);
        }}
      >
        Open
      </button>
      <Dialog open={outer} onClose={() => setOuter(false)} title="Outer">
        <button onClick={() => setOuter(false)}>Remove both</button>
        <Dialog
          open={inner}
          onClose={dismissible ? () => setInner(false) : undefined}
          title="Inner"
        >
          <button onClick={() => setInner(false)}>Finish inner</button>
        </Dialog>
      </Dialog>
    </>
  );
}

it("keeps initially nested StrictMode focus in the child and restores the original opener on both closes", async () => {
  const user = userEvent.setup();
  render(
    <React.StrictMode>
      <InitiallyNested />
    </React.StrictMode>,
  );
  const opener = screen.getByRole("button", { name: "Open" });
  await user.click(opener);
  const inner = screen.getByRole("dialog", { name: "Inner" });
  expect(within(inner).getByRole("button", { name: "Close" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Outer" })).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Outer" })).toContainElement(
    document.activeElement as HTMLElement,
  );
  await user.keyboard("{Escape}");
  expect(opener).toHaveFocus();
});

it("restores the opener when the ancestor and child are removed together, with no stale listeners on reopen", async () => {
  const user = userEvent.setup();
  render(
    <React.StrictMode>
      <InitiallyNested />
    </React.StrictMode>,
  );
  const opener = screen.getByRole("button", { name: "Open" });
  await user.click(opener);
  // Simulate an external ancestor close without moving focus out of the child.
  fireEvent.click(screen.getByRole("button", { name: "Remove both" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  await user.click(opener);
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Outer" })).toBeInTheDocument();
});

it("does not let Escape fall through a non-dismissible child", async () => {
  const user = userEvent.setup();
  render(<InitiallyNested dismissible={false} />);
  await user.click(screen.getByRole("button", { name: "Open" }));
  await user.keyboard("{Escape}");
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Finish inner" })).toHaveFocus();
});

it.each([false, true])(
  "keeps %s-shift Tab inside when a pending submit becomes disabled",
  async (shiftKey) => {
    const user = userEvent.setup();
    const view = render(
      <Dialog open title="Pending" onClose={() => undefined}>
        <button>Cancel pending</button>
        <button disabled={false}>Submit pending</button>
      </Dialog>,
    );
    const panel = screen.getByRole("dialog");
    for (const button of within(panel).getAllByRole("button"))
      Object.defineProperty(button, "offsetParent", {
        configurable: true,
        get: () => panel,
      });
    const submit = screen.getByRole("button", { name: "Submit pending" });
    submit.focus();
    view.rerender(
      <Dialog open title="Pending" onClose={() => undefined}>
        <button>Cancel pending</button>
        <button disabled>Submit pending</button>
      </Dialog>,
    );
    const key = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(
      screen.getByRole("button", {
        name: shiftKey ? "Cancel pending" : "Close",
      }),
    ).toHaveFocus();

    // Native fieldset disabling must exclude descendants too, including a
    // control with an explicit tab stop.
    view.rerender(
      <Dialog open title="Pending" onClose={() => undefined}>
        <button>Cancel pending</button>
        <fieldset>
          <button tabIndex={0}>Submit pending</button>
        </fieldset>
      </Dialog>,
    );
    for (const button of within(panel).getAllByRole("button"))
      Object.defineProperty(button, "offsetParent", {
        configurable: true,
        get: () => panel,
      });
    screen.getByRole("button", { name: "Submit pending" }).focus();
    view.rerender(
      <Dialog open title="Pending" onClose={() => undefined}>
        <button>Cancel pending</button>
        <fieldset disabled>
          <button tabIndex={0}>Submit pending</button>
        </fieldset>
      </Dialog>,
    );
    const fieldsetKey = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(fieldsetKey);
    expect(fieldsetKey.defaultPrevented).toBe(true);
    expect(
      screen.getByRole("button", {
        name: shiftKey ? "Cancel pending" : "Close",
      }),
    ).toHaveFocus();

    view.rerender(
      <Dialog open title="Pending" onClose={() => undefined}>
        <details open>
          <summary>Optional details</summary>
          <button>Inside details</button>
        </details>
        <button>Done</button>
      </Dialog>,
    );
    const summary = screen.getByText("Optional details");
    for (const element of [...within(panel).getAllByRole("button"), summary])
      Object.defineProperty(element, "offsetParent", {
        configurable: true,
        get: () => panel,
      });
    summary.focus();
    expect(summary).toHaveFocus();
    const summaryKey = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(summaryKey);
    expect(summaryKey.defaultPrevented).toBe(false);
    await user.tab({ shift: shiftKey });
    expect(
      screen.getByRole("button", {
        name: shiftKey ? "Close" : "Inside details",
      }),
    ).toHaveFocus();
  },
);
