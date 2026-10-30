/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "../dialog";
import { FormSheetActions, FormSheetActionsHost } from "../form-sheet-actions";

it("keeps sheet actions outside scrolling fields while preserving native form submission", async () => {
  const submit = jest.fn();
  function Sheet() {
    const [host, setHost] = useState<HTMLDivElement | null>(null);
    return <FormSheetActionsHost.Provider value={host}>
      <Dialog open title="Chore" variant="form" footer={<div ref={setHost} data-testid="actions" />}>
        <form id="chore-fixture" onSubmit={event => { event.preventDefault(); submit(); }}>
          <label>Title<input name="title" required /></label>
          <FormSheetActions><button type="submit" form="chore-fixture">Create chore</button></FormSheetActions>
        </form>
      </Dialog>
    </FormSheetActionsHost.Provider>;
  }
  const user = userEvent.setup();
  render(<Sheet />);
  const button = await screen.findByRole("button", { name: "Create chore" });
  const input = screen.getByRole("textbox", { name: "Title" });
  const form = input.closest("form")!;
  expect(form).not.toContainElement(button);
  expect(screen.getByTestId("actions")).toContainElement(button);
  expect((button as HTMLButtonElement).form).toBe(form);
  await user.type(input, "Take out trash");
  await user.click(button);
  expect(submit).toHaveBeenCalledTimes(1);
});
