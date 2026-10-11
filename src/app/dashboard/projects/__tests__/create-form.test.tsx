/** @jest-environment jsdom */

import "@testing-library/jest-dom";
import * as React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateProjectForm from "../create/CreateProjectForm";
import { ProjectCreateSheet } from "@/components/projects/ProjectCreateSheet";

const push = jest.fn();
const refresh = jest.fn();
const back = jest.fn();
const addToast = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, back }),
}));

jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ addToast }),
}));

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  back.mockReset();
  addToast.mockReset();
  global.fetch = jest.fn();
});

it("keeps the direct form destination and sends the selected project fields", async () => {
  const user = userEvent.setup();
  global.fetch = jest
    .fn()
    .mockResolvedValue(response(201, { project: { id: "project-1" } }));

  render(<CreateProjectForm />);

  await user.type(screen.getByLabelText(/Project Name/), "Backyard garden");
  await user.type(screen.getByLabelText(/^Description/), "Spring planting");
  await user.click(screen.getByRole("button", { name: "Color: Pink" }));
  await user.click(screen.getByRole("button", { name: "Create Project" }));

  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("/dashboard/projects/project-1"),
  );
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(
    "/api/projects",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "Backyard garden",
        description: "Spring planting",
        color: "#EC4899",
      }),
    }),
  );
  expect(screen.getByRole("button", { name: "Color: Blue" })).toHaveClass(
    "h-11",
    "w-11",
  );
});

it("retains the draft after a refused create so the user can retry", async () => {
  const user = userEvent.setup();
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      response(403, { error: "Only parents can create projects" }),
    );

  render(<CreateProjectForm />);

  const name = screen.getByLabelText(/Project Name/);
  const description = screen.getByLabelText(/^Description/);
  await user.type(name, "Shared garden");
  await user.type(description, "Keep this while retrying");
  await user.click(screen.getByRole("button", { name: "Create Project" }));

  await waitFor(() =>
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "Failed to create project",
      }),
    ),
  );
  expect(name).toHaveValue("Shared garden");
  expect(description).toHaveValue("Keep this while retrying");
  expect(push).not.toHaveBeenCalled();
});

it("blocks sheet dismissal while the project create request is pending", async () => {
  const user = userEvent.setup();
  let finish!: (result: Response) => void;
  global.fetch = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );

  render(
    <>
      <div data-dashboard-background>
        <button type="button">Projects</button>
      </div>
      <ProjectCreateSheet />
    </>,
  );

  await user.type(screen.getByLabelText(/Project Name/), "Kitchen project");
  await user.click(screen.getByRole("button", { name: "Create Project" }));
  expect(
    screen.queryByRole("button", { name: "Close and return" }),
  ).not.toBeInTheDocument();

  await user.keyboard("{Escape}");
  expect(back).not.toHaveBeenCalled();

  await act(async () =>
    finish(response(201, { project: { id: "project-2" } })),
  );
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("/dashboard/projects/project-2"),
  );
});
