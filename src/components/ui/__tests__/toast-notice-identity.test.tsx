/** @jest-environment jsdom */
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "../toast";

function Notices() {
  const { addToast, removeToast } = useToast();
  return (
    <>
      <button
        onClick={() =>
          addToast({ type: "error", title: "Another action needs attention" })
        }
      >
        Other action
      </button>
      <button
        onClick={() =>
          addToast({
            id: "reward-claim",
            type: "error",
            title: "Check this reward",
          })
        }
      >
        First refusal
      </button>
      <button
        onClick={() =>
          addToast({
            id: "reward-claim",
            type: "error",
            title: "Retry this reward",
          })
        }
      >
        Retry refusal
      </button>
      <button onClick={() => removeToast("reward-claim")}>
        Reward confirmed
      </button>
    </>
  );
}

it("replaces and clears one resolved action notice while keeping another alert", async () => {
  render(
    <ToastProvider>
      <Notices />
    </ToastProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Other action" }));
  await userEvent.click(screen.getByRole("button", { name: "First refusal" }));
  expect(screen.getByText("Check this reward")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Retry refusal" }));
  expect(screen.queryByText("Check this reward")).toBeNull();
  expect(screen.getAllByText("Retry this reward")).toHaveLength(1);
  await userEvent.click(
    screen.getByRole("button", { name: "Reward confirmed" }),
  );
  expect(screen.queryByText("Retry this reward")).toBeNull();
  expect(screen.getByText("Another action needs attention")).toBeTruthy();
});
