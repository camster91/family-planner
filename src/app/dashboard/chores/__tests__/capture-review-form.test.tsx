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

// Authored UNRUN: ordinary account creation holds unknown outcomes instead of minting a replacement save.
it("serializes ordinary submits and holds an interrupted create before any replacement", async () => {
  const read = global.fetch;
  global.fetch = jest.fn(async (path, init) => {
    if (init?.method === "POST") throw new Error("Fixture unknown save");
    return read(path, init);
  }) as typeof fetch;
  render(<CreateChoreForm inSheet />);
  await screen.findByRole("option", { name: "Synthetic parent" });
  await waitFor(() => expect((screen.getByRole("combobox", { name: "Assign To" }) as HTMLSelectElement).value).toBe("fixture-parent"));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Synthetic ordinary task" } });
  fireEvent.change(screen.getByLabelText("Due Date"), { target: { value: "2099-10-05" } });
  const form = screen.getByLabelText("Title").closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  await screen.findByText("This chore may already have been saved. Check Chores before creating another.");
  const writes = jest.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");
  expect(writes).toHaveLength(1);
  expect(typeof (writes[0][1]!.headers as Record<string, string>)["Idempotency-Key"]).toBe("string");
  expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Check Chores" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/chores"));
  expect(jest.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});

// Authored UNRUN: a successful upload reply must still name a canonical private chore photo.
it("keeps the previous captured-task picture when an upload reply has an invalid path", async () => {
  const old = "/api/files/chores/0123456789abcdef.jpg";
  const read = global.fetch;
  global.fetch = jest.fn(async (path, init) => path === "/api/upload"
    ? { ok: true, status: 200, json: async () => ({ url: "/api/files/chores/invalid-file" }) }
    : read(path, init)) as typeof fetch;
  render(<CreateChoreForm inSheet review={{ initial: { ...initial, photoUrl: old }, onChange: jest.fn(), onReview: jest.fn(), submitLabel: "Use reviewed task" }} />);
  const input = screen.getByLabelText("Photo") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["fixture"], "photo.jpg", { type: "image/jpeg" })] } });
  await screen.findByText("The photo upload could not be confirmed. Your previous picture is kept. Choose the photo again to retry; an uploaded file may already exist.");
  expect(screen.getByAltText("Preview")).toHaveAttribute("src", old);
  expect(jest.mocked(fetch).mock.calls.filter(([path]) => path === "/api/upload")).toHaveLength(1);
});
