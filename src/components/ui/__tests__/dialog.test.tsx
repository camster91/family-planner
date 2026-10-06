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
