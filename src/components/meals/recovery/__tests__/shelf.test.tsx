/** Authored/unrun. Explicit actions and local-removal acknowledgement. */
import { fireEvent, render, screen } from "@testing-library/react";
import { BulkRecoveryShelf } from "../BulkRecoveryShelf";
import type { BulkRecovery } from "../useBulkRecovery";
import { context, entry } from "@/lib/meal-prep-recovery/__tests__/fixture";
jest.mock("@/i18n", () => ({ useTranslation: () => ({ locale: "en" }) }));
function recovery() {
  return {
    mode: "owned",
    context: context(),
    rows: [entry()],
    confirmed: {},
    inspections: {},
    draft: null,
    active: false,
    busy: false,
    held: false,
    privacyHold: false,
    issue: null,
    inspect: jest.fn(),
    retry: jest.fn(),
    dismiss: jest.fn(),
    repair: jest.fn(),
    load: jest.fn(),
  } as unknown as BulkRecovery;
}
it("never dispatches on mount and requires acknowledgement before forgetting unknown work", () => {
  const state = recovery();
  render(
    <BulkRecoveryShelf
      recovery={state}
      onRestore={jest.fn()}
      onReloadStored={jest.fn()}
      restoreError={false}
    />,
  );
  expect(state.inspect).not.toHaveBeenCalled();
  expect(state.retry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Inspect receipt" }));
  expect(state.inspect).toHaveBeenCalledWith(entry().key);
  fireEvent.click(
    screen.getByRole("button", { name: "Forget local request…" }),
  );
  expect(screen.getByRole("button", { name: "Remove locally" })).toBeDisabled();
  expect(state.dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "I understand" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove locally" }));
  expect(state.dismiss).toHaveBeenCalledWith(entry().key);
});
it("requires acknowledgement before replacing an active form with the stored copy", () => {
  const state = {
      ...recovery(),
      issue: "held" as const,
      active: true,
      held: true,
    },
    reload = jest.fn();
  render(
    <BulkRecoveryShelf
      recovery={state}
      onRestore={jest.fn()}
      onReloadStored={reload}
      restoreError={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reload stored copy…" }));
  expect(
    screen.getByRole("button", { name: "Reload stored copy" }),
  ).toBeDisabled();
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "I understand" }));
  fireEvent.click(screen.getByRole("button", { name: "Reload stored copy" }));
  expect(reload).toHaveBeenCalledTimes(1);
});
it("offers receipt inspection during pause and omits exact retries without a current proof", () => {
  const state = { ...recovery(), context: { ...context(), enabled: false } };
  render(
    <BulkRecoveryShelf
      recovery={state}
      onRestore={jest.fn()}
      onReloadStored={jest.fn()}
      restoreError={false}
    />,
  );
  expect(screen.getByText(/New bulk saves are paused/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Inspect receipt" })).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "Retry exact request" }),
  ).not.toBeInTheDocument();
});
