/** @jest-environment jsdom */

import "@testing-library/jest-dom";
import * as React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import CreateProjectForm from "../create/CreateProjectForm";
import { ProjectCreateSheet } from "@/components/projects/ProjectCreateSheet";
import { isValidIdempotencyKey } from "@/lib/idempotency-key";

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
  const headers = (global.fetch as jest.Mock).mock.calls[0][1]
    .headers as Record<string, string>;
  expect(isValidIdempotencyKey(headers["Idempotency-Key"])).toBe(true);
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

it("retries an in-progress create with the same idempotency key", async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn().mockResolvedValue(
    response(409, {
      error: {
        code: "IDEMPOTENCY_IN_PROGRESS",
        message: "Please retry this project request.",
      },
    }),
  );

  render(<CreateProjectForm />);
  const name = screen.getByLabelText(/Project Name/);
  await user.type(name, "Shared garden");
  await user.click(screen.getByRole("button", { name: "Create Project" }));
  await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
  const firstKey = (
    (global.fetch as jest.Mock).mock.calls[0][1].headers as Record<
      string,
      string
    >
  )["Idempotency-Key"];

  (global.fetch as jest.Mock).mockResolvedValue(
    response(201, { project: { id: "project-retry" } }),
  );
  await user.click(screen.getByRole("button", { name: "Create Project" }));
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("/dashboard/projects/project-retry"),
  );
  const secondKey = (
    (global.fetch as jest.Mock).mock.calls[1][1].headers as Record<
      string,
      string
    >
  )["Idempotency-Key"];
  expect(secondKey).toBe(firstKey);
});

it("reuses the network-failed key when the user returns to the original draft", async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

  render(<CreateProjectForm />);
  const name = screen.getByLabelText(/Project Name/);
  await user.type(name, "Original garden");
  await user.click(screen.getByRole("button", { name: "Create Project" }));
  await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
  expect(addToast).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "Couldn't create the project. Check your connection and try again.",
    }),
  );
  const firstKey = (
    (global.fetch as jest.Mock).mock.calls[0][1].headers as Record<
      string,
      string
    >
  )["Idempotency-Key"];

  await user.clear(name);
  await user.type(name, "Updated garden");
  await user.click(screen.getByRole("button", { name: "Create Project" }));
  await waitFor(() => expect(addToast).toHaveBeenCalledTimes(2));
  const changedDraftKey = (
    (global.fetch as jest.Mock).mock.calls[1][1].headers as Record<
      string,
      string
    >
  )["Idempotency-Key"];

  await user.clear(name);
  await user.type(name, "Original garden");
  await user.click(screen.getByRole("button", { name: "Create Project" }));
  await waitFor(() => expect(addToast).toHaveBeenCalledTimes(3));
  const returnedDraftKey = (
    (global.fetch as jest.Mock).mock.calls[2][1].headers as Record<
      string,
      string
    >
  )["Idempotency-Key"];

  expect(changedDraftKey).not.toBe(firstKey);
  expect(returnedDraftKey).toBe(firstKey);
});

it("retries a server failure with the same idempotency key", async () => {
  const user = userEvent.setup();
  global.fetch = jest
    .fn()
    .mockResolvedValue(response(503, { error: "Please try again." }));

  render(<CreateProjectForm />);
  const name = screen.getByLabelText(/Project Name/);
  await user.type(name, "Shared garden");
  await user.click(screen.getByRole("button", { name: "Create Project" }));
  await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
  const firstKey = (
    (global.fetch as jest.Mock).mock.calls[0][1].headers as Record<
      string,
      string
    >
  )["Idempotency-Key"];

  (global.fetch as jest.Mock).mockResolvedValue(
    response(201, { project: { id: "project-retry-503" } }),
  );
  await user.click(screen.getByRole("button", { name: "Create Project" }));
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("/dashboard/projects/project-retry-503"),
  );
  const secondKey = (
    (global.fetch as jest.Mock).mock.calls[1][1].headers as Record<
      string,
      string
    >
  )["Idempotency-Key"];
  expect(secondKey).toBe(firstKey);
});

it("starts a new idempotency key after a definitive refusal", async () => {
  const user = userEvent.setup();
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      response(403, { error: "Only parents can create projects" }),
    );

  render(<CreateProjectForm />);
  const name = screen.getByLabelText(/Project Name/);
  await user.type(name, "Shared garden");
  await user.click(screen.getByRole("button", { name: "Create Project" }));
  await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
  const firstKey = (
    (global.fetch as jest.Mock).mock.calls[0][1].headers as Record<
      string,
      string
    >
  )["Idempotency-Key"];

  (global.fetch as jest.Mock).mockResolvedValue(
    response(201, { project: { id: "project-after-refusal" } }),
  );
  await user.click(screen.getByRole("button", { name: "Create Project" }));
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith(
      "/dashboard/projects/project-after-refusal",
    ),
  );
  const secondKey = (
    (global.fetch as jest.Mock).mock.calls[1][1].headers as Record<
      string,
      string
    >
  )["Idempotency-Key"];
  expect(secondKey).not.toBe(firstKey);
});

it.each([undefined, null, 42, {}, "   "])(
  "keeps the draft and refuses a successful response without a non-empty string id (%s)",
  async (id) => {
    const user = userEvent.setup();
    global.fetch = jest
      .fn()
      .mockResolvedValue(response(201, { project: { id } }));

    render(<CreateProjectForm />);

    const name = screen.getByLabelText(/Project Name/);
    const description = screen.getByLabelText(/^Description/);
    await user.type(name, "Shared garden");
    await user.type(description, "Keep this after an invalid response");
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
    expect(description).toHaveValue("Keep this after an invalid response");
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  },
);

it("retries a malformed create success with the same idempotency key", async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn().mockResolvedValue(response(201, { project: {} }));

  render(<CreateProjectForm />);
  const name = screen.getByLabelText(/Project Name/);
  await user.type(name, "Shared garden");
  await user.click(screen.getByRole("button", { name: "Create Project" }));
  await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
  const firstKey = (
    (global.fetch as jest.Mock).mock.calls[0][1].headers as Record<
      string,
      string
    >
  )["Idempotency-Key"];

  (global.fetch as jest.Mock).mockResolvedValue(
    response(201, { project: { id: "project-retry" } }),
  );
  await user.click(screen.getByRole("button", { name: "Create Project" }));
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("/dashboard/projects/project-retry"),
  );
  const secondKey = (
    (global.fetch as jest.Mock).mock.calls[1][1].headers as Record<
      string,
      string
    >
  )["Idempotency-Key"];
  expect(secondKey).toBe(firstKey);
});

it("localizes project create labels and refusal feedback in Spanish", async () => {
  const user = userEvent.setup();
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      response(403, { error: "Only parents can create projects" }),
    );

  render(
    <I18nProvider locale="es">
      <CreateProjectForm />
    </I18nProvider>,
  );

  const name = screen.getByLabelText(/Nombre del proyecto/);
  await user.type(name, "Huerto familiar");
  expect(screen.getByText("Color de acento")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Color: Rosa" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Crear proyecto" }));

  await waitFor(() =>
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "No se pudo crear el proyecto",
        message: "Inténtalo de nuevo.",
      }),
    ),
  );
  expect(name).toHaveValue("Huerto familiar");
});

it.each([
  [
    "en",
    "Project Name",
    "Create Project",
    "Close and return",
    "Please wait for saving to finish.",
  ],
  [
    "es",
    "Nombre del proyecto",
    "Crear proyecto",
    "Cerrar y volver",
    "Espera a que termine de guardarse.",
  ],
] as const)(
  "blocks %s sheet dismissal while the project create request is pending",
  async (locale, nameLabel, submitLabel, closeLabel, pendingDescription) => {
    const user = userEvent.setup();
    let finish!: (result: Response) => void;
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );

    render(
      <I18nProvider locale={locale}>
        <div data-dashboard-background>
          <button type="button">Projects</button>
        </div>
        <ProjectCreateSheet />
      </I18nProvider>,
    );

    await user.type(
      screen.getByLabelText(new RegExp(nameLabel)),
      "Kitchen project",
    );
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(screen.getByText(pendingDescription)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: closeLabel }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(back).not.toHaveBeenCalled();

    await act(async () =>
      finish(response(201, { project: { id: "project-2" } })),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/dashboard/projects/project-2"),
    );
  },
);

it("replaces the direct Back link while a request is pending", async () => {
  const user = userEvent.setup();
  let release!: (value: Response) => void;
  global.fetch = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );

  render(<CreateProjectForm />);

  const name = screen.getByLabelText(/Project Name/);
  await user.type(name, "Kitchen project");
  expect(
    screen.getByRole("link", { name: "Back to Projects" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Create Project" }));
  expect(
    screen.queryByRole("link", { name: "Back to Projects" }),
  ).not.toBeInTheDocument();
  expect(screen.getByTestId("project-create-back-busy")).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  await act(async () =>
    release(response(201, { project: { id: "project-3" } })),
  );
});
