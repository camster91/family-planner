/** @jest-environment jsdom */
/** Authored only; consolidated QA is deferred. */
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CreateChoreForm from "../create/CreateChoreForm";
import type { CaptureChoreDraft } from "@/lib/capture-chore-review";
const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
}));
jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => true,
}));
const initial: CaptureChoreDraft = {
  title: "Pack the bag",
  description: "",
  points: "10",
  assignment: { kind: "account", id: "" },
  dueDate: "2099-10-05",
  weeklyStart: "",
  frequency: "once",
  difficulty: "medium",
  weeklyDays: [],
  photoUrl: null,
  icon: null,
  routine: "",
  routineOrder: "",
  takeTurns: false,
  rotation: [],
};
beforeEach(() => {
  push.mockClear();
  global.fetch = jest.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url === "/api/family/members"
        ? {
            members: [
              {
                id: "fixture-parent",
                name: "Synthetic parent",
                role: "parent",
              },
            ],
          }
        : { profiles: [] },
  })) as unknown as typeof fetch;
});
it("requires a deliberate account choice and returns a reviewed request without POST or navigation", async () => {
  const reviewed = jest.fn(),
    changed = jest.fn();
  render(
    <CreateChoreForm
      inSheet
      review={{
        initial,
        onChange: changed,
        onReview: reviewed,
        submitLabel: "Use reviewed task",
      }}
    />,
  );
  const assignment = await screen.findByRole("combobox", { name: "Assign To" });
  await screen.findByRole("option", { name: "Synthetic parent" });
  expect((assignment as HTMLSelectElement).value).toBe("");
  expect(
    screen.getByRole("button", { name: "Use reviewed task" }),
  ).toBeDisabled();
  fireEvent.change(assignment, { target: { value: "fixture-parent" } });
  await waitFor(() => expect(changed).toHaveBeenCalled());
  fireEvent.submit(assignment.closest("form")!);
  await waitFor(() => expect(reviewed).toHaveBeenCalledTimes(1));
  expect(reviewed.mock.calls[0][1].action).toBe("chore.create");
  expect(JSON.parse(reviewed.mock.calls[0][1].body)).toMatchObject({
    title: initial.title,
    assigned_to: "fixture-parent",
    due_date: initial.dueDate,
  });
  expect(
    jest
      .mocked(fetch)
      .mock.calls.every(([, init]) => !init?.method || init.method === "GET"),
  ).toBe(true);
  expect(jest.mocked(fetch).mock.calls.filter(([path]) => path === "/api/family/members")).toHaveLength(1);
  expect(push).not.toHaveBeenCalled();
});
it("keeps unfinished date and number strings when restoring a saved task", () => {
  render(
    <CreateChoreForm
      inSheet
      review={{
        initial: {
          ...initial,
          points: "1.",
          dueDate: "2099-",
          routine: "Morning",
          routineOrder: "2.",
        },
        onChange: jest.fn(),
        onReview: jest.fn(),
        submitLabel: "Use reviewed task",
      }}
    />,
  );
  expect((screen.getByLabelText("Points") as HTMLInputElement).value).toBe(
    "1.",
  );
  expect((screen.getByLabelText("Due Date") as HTMLInputElement).value).toBe(
    "2099-",
  );
  expect((screen.getByLabelText("Step") as HTMLInputElement).value).toBe("2.");
});

// Authored UNRUN: failed choices can retry without replacing the captured draft.
it("preserves task fields through explicit family-choice retry", async () => {
  let memberAttempts = 0;
  global.fetch = jest.fn(async (url: string) => {
    if (url === "/api/family/members") {
      memberAttempts++;
      if (memberAttempts === 1) throw new Error("Fixture offline");
      return { ok: true, status: 200, json: async () => ({ members: [{ id: "fixture-parent", name: "Synthetic parent", role: "parent" }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ profiles: [] }) };
  }) as unknown as typeof fetch;
  render(<CreateChoreForm inSheet review={{ initial, onChange: jest.fn(), onReview: jest.fn(), submitLabel: "Use reviewed task" }} />);
  const retry = await screen.findByRole("button", { name: "Retry family choices" });
  expect(screen.getByDisplayValue(initial.title)).toBeInTheDocument();
  fireEvent.click(retry);
  await screen.findByRole("option", { name: "Synthetic parent" });
  expect(screen.getByDisplayValue(initial.title)).toBeInTheDocument();
  expect((screen.getByRole("combobox", { name: "Assign To" }) as HTMLSelectElement).value).toBe("");
  expect(memberAttempts).toBe(2);
});
