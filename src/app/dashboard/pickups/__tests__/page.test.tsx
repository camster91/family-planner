/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { pickupsMessages } from "@/i18n/pickups";
import PickupsPage from "../page";

jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => true,
}));

const futurePickup = {
  id: "pickup-1",
  title: "School pickup",
  location: "School",
  pickup_time: "2030-10-15T15:00:00.000Z",
  completed: false,
  assigned_to: "member-1",
  assignee_name: "Sam",
  assignee_avatar: null,
  notes: null,
};

function response(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body } as Response;
}

function renderPage(locale: "en" | "es" = "en") {
  return render(
    <I18nProvider locale={locale}>
      <ToastProvider>
        <PickupsPage />
      </ToastProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, "", "/dashboard/pickups");
});

afterEach(() => {
  window.history.replaceState({}, "", "/dashboard/pickups");
});

it("keeps the English and Spanish pickup dictionaries in lockstep", () => {
  expect(Object.keys(pickupsMessages.en).sort()).toEqual(
    Object.keys(pickupsMessages.es).sort(),
  );
  for (const key of Object.keys(pickupsMessages.en) as Array<
    keyof typeof pickupsMessages.en
  >) {
    expect(pickupsMessages.es[key].trim()).not.toBe("");
  }
});

it("does not show a false empty state after a failed load and recovers with retry", async () => {
  let pickupRequests = 0;
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/pickups") {
      pickupRequests += 1;
      return pickupRequests === 1
        ? response({}, false)
        : response({ pickups: [futurePickup] });
    }
    if (url === "/api/family/members") return response({ members: [] });
    return response({});
  }) as unknown as typeof fetch;

  const user = userEvent.setup();
  renderPage();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't load pickups",
  );
  expect(screen.queryByText("No pickups yet")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));

  expect(await screen.findByRole("checkbox")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps existing rows visible when a post succeeds but the refresh fails", async () => {
  let pickupRequests = 0;
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/pickups" && !init?.method) {
        pickupRequests += 1;
        return pickupRequests === 1
          ? response({ pickups: [futurePickup] })
          : response({}, false);
      }
      if (url === "/api/family/members") return response({ members: [] });
      if (url === "/api/pickups" && init?.method === "POST")
        return response({ pickup: { ...futurePickup, id: "pickup-2" } });
      return response({});
    },
  ) as unknown as typeof fetch;

  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("checkbox");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.type(screen.getByLabelText("Title"), "Library pickup");
  fireEvent.change(screen.getByLabelText("When"), {
    target: { value: "2030-10-15T16:00" },
  });
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't load pickups",
  );
  expect(screen.getByText("School pickup")).toBeInTheDocument();
  expect(screen.queryByText("No pickups yet")).not.toBeInTheDocument();
});

it("serializes completion toggles and restores the exact prior state on refusal", async () => {
  let resolvePatch: ((value: Response) => void) | undefined;
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/pickups" && !init?.method)
      return Promise.resolve(response({ pickups: [futurePickup] }));
    if (url === "/api/family/members")
      return Promise.resolve(response({ members: [] }));
    if (url === "/api/pickups/pickup-1") {
      return new Promise<Response>((resolve) => {
        resolvePatch = resolve;
      });
    }
    return Promise.resolve(response({}));
  }) as unknown as typeof fetch;

  const user = userEvent.setup();
  renderPage();
  const checkbox = await screen.findByRole("checkbox");
  await user.click(checkbox);
  const pendingCheckbox = await waitFor(() => {
    const current = screen.getByRole("checkbox");
    expect(current).toHaveAttribute("aria-disabled", "true");
    return current;
  });
  fireEvent.click(pendingCheckbox);

  expect(
    (global.fetch as jest.Mock).mock.calls.filter(
      ([, init]) => init?.method === "PATCH",
    ),
  ).toHaveLength(1);
  expect(pendingCheckbox).toHaveAttribute("aria-disabled", "true");

  resolvePatch?.(response({}, false, 403));
  await waitFor(() =>
    expect(screen.getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "false",
    ),
  );
  expect(screen.getByRole("checkbox")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(
    await screen.findByText("Couldn't update the pickup"),
  ).toBeInTheDocument();
});

it("keeps the Spanish draft through Escape and restores focus to Add", async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/pickups") return response({ pickups: [] });
    if (url === "/api/family/members") return response({ members: [] });
    return response({});
  }) as unknown as typeof fetch;

  const user = userEvent.setup();
  renderPage("es");
  const add = await screen.findByRole("button", { name: "Añadir" });
  await user.click(add);
  const dialog = await screen.findByRole("dialog", { name: "Nueva recogida" });
  expect(within(dialog).getByLabelText("Título")).toHaveFocus();
  await user.type(screen.getByLabelText("Título"), "Recogida de Emma");
  await user.keyboard("{Escape}");

  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(add).toHaveFocus();
  await user.click(add);
  expect(await screen.findByLabelText("Título")).toHaveValue(
    "Recogida de Emma",
  );
  expect(
    screen.getByRole("dialog", { name: "Nueva recogida" }),
  ).toHaveTextContent("Cancelar");
});

it("consumes the form history marker when Escape closes the draft", async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/pickups") return response({ pickups: [] });
    if (url === "/api/family/members") return response({ members: [] });
    return response({});
  }) as unknown as typeof fetch;

  const user = userEvent.setup();
  const backSpy = jest.spyOn(window.history, "back");
  const replaceSpy = jest.spyOn(window.history, "replaceState");
  renderPage();
  const add = await screen.findByRole("button", { name: "Add" });
  await user.click(add);

  await user.keyboard("{Escape}");

  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(backSpy).toHaveBeenCalledTimes(1);
  });
  expect(replaceSpy).not.toHaveBeenCalled();
  backSpy.mockRestore();
  replaceSpy.mockRestore();
});

it("blocks dismissal and duplicate submits while saving, then restores Add focus", async () => {
  let resolvePost: ((value: Response) => void) | undefined;
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/pickups" && !init?.method)
      return Promise.resolve(response({ pickups: [] }));
    if (url === "/api/family/members")
      return Promise.resolve(response({ members: [] }));
    if (url === "/api/pickups" && init?.method === "POST") {
      return new Promise<Response>((resolve) => {
        resolvePost = resolve;
      });
    }
    return Promise.resolve(response({}));
  }) as unknown as typeof fetch;

  const user = userEvent.setup();
  renderPage();
  const add = await screen.findByRole("button", { name: "Add" });
  const backSpy = jest.spyOn(window.history, "back");
  await user.click(add);
  await user.type(screen.getByLabelText("Title"), "School pickup");
  fireEvent.change(screen.getByLabelText("When"), {
    target: { value: "2030-10-15T15:00" },
  });
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("dialog", { name: "New pickup" }),
  ).toBeInTheDocument();
  expect(
    (global.fetch as jest.Mock).mock.calls.filter(
      ([, init]) => init?.method === "POST",
    ),
  ).toHaveLength(1);

  resolvePost?.(response({ pickup: { ...futurePickup, id: "pickup-2" } }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(add).toHaveFocus();
  expect(backSpy).toHaveBeenCalledTimes(1);
  backSpy.mockRestore();
});
