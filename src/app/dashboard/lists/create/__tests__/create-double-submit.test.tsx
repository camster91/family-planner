/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
// After "List created!" the page waits before redirecting. The Create button
// used to come back during that pause, so a second tap made a second list.
import * as React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = jest.fn();
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import CreateListForm from "../CreateListForm";

let creates: number;

beforeEach(() => {
  creates = 0;
  push.mockClear();
  global.fetch = jest.fn(async () => {
    creates += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ list: { id: "l1" } }),
    } as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

it("keeps Create disabled from success until the redirect", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(<CreateListForm />);

  await user.type(screen.getByLabelText("Name"), "Weekly Groceries");
  await user.click(screen.getByRole("button", { name: /Create List/ }));
  expect(await screen.findByRole("status")).toHaveProperty(
    "textContent",
    "List created!",
  );

  const button = screen.getByRole("button", {
    name: "List created",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  await user.click(button);
  expect(creates).toBe(1);

  await act(async () => {
    jest.advanceTimersByTime(1500);
  });
  expect(push).toHaveBeenCalledWith("/dashboard/lists");
  expect(creates).toBe(1);
});

it("keeps the direct Back control noninteractive during the success pause", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(<CreateListForm />);

  await user.type(screen.getByLabelText("Name"), "Weekly Groceries");
  await user.click(screen.getByRole("button", { name: /Create List/ }));
  await screen.findByRole("status");

  expect(screen.getByTestId("list-create-back-busy")).toHaveTextContent(
    "Lists",
  );
  expect(
    screen.queryByRole("link", { name: "Lists" }),
  ).not.toBeInTheDocument();
});

it("a double tap on Create sends one request", async () => {
  const user = userEvent.setup();
  render(<CreateListForm />);
  await user.type(screen.getByLabelText("Name"), "Chores");
  await user.dblClick(screen.getByRole("button", { name: /Create List/ }));
  await screen.findByRole("status");
  expect(creates).toBe(1);
});

it("a failed create lets the parent try again", async () => {
  global.fetch = jest.fn(async () => {
    creates += 1;
    return {
      ok: false,
      status: 500,
      json: async () => ({ error: "Server error" }),
    } as Response;
  }) as unknown as typeof fetch;
  const user = userEvent.setup();
  render(<CreateListForm />);
  await user.type(screen.getByLabelText("Name"), "Chores");
  await user.click(screen.getByRole("button", { name: /Create List/ }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "The list could not be created. Try again.",
  );
  await user.click(screen.getByRole("button", { name: /Create List/ }));
  await screen.findByRole("alert");
  expect(creates).toBe(2);
});

it("creates a named Custom checklist using the canonical API", async () => {
  const user = userEvent.setup();
  render(<CreateListForm />);
  await user.click(screen.getByRole("button", { name: "Custom" }));
  expect(
    screen.getByRole("button", { name: /Custom/ }).getAttribute("aria-pressed"),
  ).toBe("true");
  await user.type(screen.getByLabelText("Name"), "Camping packing");
  await user.type(screen.getByLabelText(/Description/), "Things for the trip");
  await user.click(screen.getByRole("button", { name: /Create List/ }));
  await screen.findByRole("status");
  expect(fetch).toHaveBeenCalledWith(
    "/api/lists/create",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "Camping packing",
        type: "custom",
        description: "Things for the trip",
      }),
    }),
  );
  expect(creates).toBe(1);
});

it("waits for image upload and includes the private image on creation", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const image = "/api/files/chores/abcdef0123456789.jpg";
  let finish!: (response: Response) => void;
  global.fetch = jest.fn((url: string) =>
    url === "/api/upload"
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({
          ok: true,
          json: async () => ({ list: { id: "l1" } }),
        } as Response),
  ) as unknown as typeof fetch;
  const { container } = render(<CreateListForm />);
  await user.type(screen.getByLabelText("Name"), "Camping");
  await user.click(container.querySelector("summary")!);
  await user.upload(
    screen.getByLabelText("Choose list image"),
    new File(["fixture"], "cover.jpg", { type: "image/jpeg" }),
  );
  expect(
    (
      screen.getByRole("button", {
        name: /Uploading image/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await act(async () =>
    finish({ ok: true, json: async () => ({ url: image }) } as Response),
  );
  expect(screen.getByRole("img", { name: "Selected list image" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /Create List/ }));
  expect(fetch).toHaveBeenCalledWith(
    "/api/lists/create",
    expect.objectContaining({
      body: JSON.stringify({
        name: "Camping",
        type: "grocery",
        image_url: image,
      }),
    }),
  );
});

it("localizes the create form and keeps unexpected API errors out of the UI", async () => {
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: "Raw household detail {private} 李" }),
  })) as unknown as typeof fetch;
  const { I18nProvider } = await import("@/i18n");
  const user = userEvent.setup();
  render(
    <I18nProvider locale="es">
      <CreateListForm />
    </I18nProvider>,
  );

  expect(
    screen.getByRole("heading", { name: "Nueva lista" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Personalizada" }),
  ).toBeInTheDocument();
  await user.type(screen.getByLabelText("Nombre"), "Plan de viaje");
  await user.click(screen.getByRole("button", { name: "Crear lista" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "No se pudo crear la lista. Inténtalo de nuevo.",
  );
  expect(alert).not.toHaveTextContent("Raw household detail");
});

it("renders the localized refusal state without offering the form", async () => {
  const { I18nProvider } = await import("@/i18n");
  render(
    <I18nProvider locale="es">
      <CreateListForm canCreate={false} />
    </I18nProvider>,
  );

  expect(screen.getByTestId("list-create-refused")).toHaveTextContent(
    "Pide a un padre o madre que cree una lista para tu familia.",
  );
  expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
});
