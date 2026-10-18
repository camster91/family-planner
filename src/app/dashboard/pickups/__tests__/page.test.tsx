/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import {
  act,
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

let mockCanManage = true;

jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => true,
  useFeatures: () => ({ canManage: mockCanManage }),
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

function renderPage(locale: "en" | "es" = "en", strict = false) {
  const page = (
    <I18nProvider locale={locale}>
      <ToastProvider>
        <PickupsPage />
      </ToastProvider>
    </I18nProvider>
  );
  return render(strict ? <React.StrictMode>{page}</React.StrictMode> : page);
}

beforeEach(() => {
  mockCanManage = true;
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

it("uses the broader board frame while keeping the add flow in a form sheet", async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/pickups") return response({ pickups: [] });
    if (url === "/api/family/members") return response({ members: [] });
    return response({});
  }) as unknown as typeof fetch;

  const user = userEvent.setup();
  renderPage();

  const board = document.querySelector<HTMLElement>(
    "[data-pickups-background]",
  );
  expect(board).toHaveClass("w-full", "min-w-0");
  expect(board).not.toHaveClass("max-w-2xl");
  expect(board).not.toHaveClass("max-w-4xl");

  await user.click(await screen.findByRole("button", { name: "Add" }));
  expect(screen.getByRole("dialog", { name: "New pickup" })).toHaveClass(
    "sm:max-w-xl",
  );
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

it("does not duplicate the history marker during StrictMode effect replay", async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/pickups") return response({ pickups: [] });
    if (url === "/api/family/members") return response({ members: [] });
    return response({});
  }) as unknown as typeof fetch;

  const user = userEvent.setup();
  const pushSpy = jest.spyOn(window.history, "pushState");
  renderPage("en", true);
  await user.click(await screen.findByRole("button", { name: "Add" }));

  expect(pushSpy).toHaveBeenCalledTimes(1);
  pushSpy.mockRestore();
});

it("keeps a pending close locked until its back traversal completes", async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/pickups") return response({ pickups: [] });
    if (url === "/api/family/members") return response({ members: [] });
    return response({});
  }) as unknown as typeof fetch;

  const user = userEvent.setup();
  const backSpy = jest
    .spyOn(window.history, "back")
    .mockImplementation(() => undefined);
  renderPage();
  const add = await screen.findByRole("button", { name: "Add" });
  await user.click(add);
  const firstMarker = (window.history.state as { pickupForm?: unknown })
    .pickupForm;
  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("dialog", { name: "New pickup" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(document.body.style.overflow).toBe("hidden");

  await act(async () => {
    window.history.replaceState({}, "", "/dashboard/pickups");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(document.body.style.overflow).toBe("");
  await user.click(add);
  const dialog = await screen.findByRole("dialog", { name: "New pickup" });
  expect(dialog).toBeInTheDocument();
  const reopenedMarker = (window.history.state as { pickupForm?: unknown })
    .pickupForm;
  expect(reopenedMarker).toMatch(/^pickup-form-/);
  expect(reopenedMarker).not.toBe(firstMarker);
  expect(backSpy).toHaveBeenCalledTimes(1);
  backSpy.mockRestore();
});

it("consumes its marker when the form owner unmounts", async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/pickups") return response({ pickups: [] });
    if (url === "/api/family/members") return response({ members: [] });
    return response({});
  }) as unknown as typeof fetch;

  const user = userEvent.setup();
  const backSpy = jest
    .spyOn(window.history, "back")
    .mockImplementation(() => undefined);
  const view = renderPage();
  await user.click(await screen.findByRole("button", { name: "Add" }));
  view.unmount();

  await waitFor(() => expect(backSpy).toHaveBeenCalledTimes(1));
  backSpy.mockRestore();
});

it("preserves a same-URL Next entry when closing after its state changes", async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/pickups") return response({ pickups: [] });
    if (url === "/api/family/members") return response({ members: [] });
    return response({});
  }) as unknown as typeof fetch;

  const user = userEvent.setup();
  const backSpy = jest
    .spyOn(window.history, "back")
    .mockImplementation(() => undefined);
  renderPage();
  const add = await screen.findByRole("button", { name: "Add" });
  await user.click(add);
  const marker = (window.history.state as { pickupForm?: unknown }).pickupForm;
  window.history.pushState(
    {
      __N: true,
      customNextState: "preserve-me",
      pickupForm: marker,
    },
    "",
    "/dashboard/pickups",
  );

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(window.history.state).toMatchObject({
    __N: true,
    customNextState: "preserve-me",
  });
  expect((window.history.state as { pickupForm?: unknown }).pickupForm).toBe(
    undefined,
  );
  expect(backSpy).not.toHaveBeenCalled();
  backSpy.mockRestore();
});

it("removes only its marker when unmount inherits a same-route Next state", async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/pickups") return response({ pickups: [] });
    if (url === "/api/family/members") return response({ members: [] });
    return response({});
  }) as unknown as typeof fetch;

  const user = userEvent.setup();
  const backSpy = jest
    .spyOn(window.history, "back")
    .mockImplementation(() => undefined);
  const view = renderPage();
  await user.click(await screen.findByRole("button", { name: "Add" }));
  const marker = (window.history.state as { pickupForm?: unknown }).pickupForm;
  expect(marker).toEqual(expect.stringMatching(/^pickup-form-/));
  view.unmount();

  window.history.pushState(
    {
      __N: true,
      customNextState: "preserve-me",
      pickupForm: marker,
    },
    "",
    "/dashboard/pickups",
  );
  await waitFor(() => {
    expect((window.history.state as { pickupForm?: unknown }).pickupForm).toBe(
      undefined,
    );
  });
  expect(window.history.state).toMatchObject({
    __N: true,
    customNextState: "preserve-me",
  });
  expect(backSpy).not.toHaveBeenCalled();
  backSpy.mockRestore();
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

it("deletes only after confirmation and keeps the dialog locked while pending", async () => {
  let finish: ((value: Response) => void) | undefined;
  const fetcher = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "DELETE")
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    if (String(input) === "/api/pickups")
      return Promise.resolve(response({ pickups: [futurePickup] }));
    return Promise.resolve(response({ members: [] }));
  });
  global.fetch = fetcher as unknown as typeof fetch;
  const user = userEvent.setup();
  renderPage();
  await user.click(
    await screen.findByRole("button", { name: "Delete pickup: School pickup" }),
  );
  const dialog = screen.getByRole("alertdialog", { name: "Delete pickup" });
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(
    false,
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Delete pickup" }),
  );
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("alertdialog")).toBeVisible();
  expect(screen.getByRole("checkbox")).toBeInTheDocument();
  await act(async () => {
    finish?.(response({ ok: true }));
  });
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE"),
  ).toHaveLength(1);
});

it("retains the pickup after refused deletion and failed refresh, and allows cancel", async () => {
  let failRefresh = false;
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE")
        return response({ error: "Parents only" }, false, 403);
      if (String(input) === "/api/pickups")
        return failRefresh
          ? response({}, false)
          : response({ pickups: [futurePickup] });
      return response({ members: [] });
    },
  ) as unknown as typeof fetch;
  const user = userEvent.setup();
  renderPage();
  await user.click(
    await screen.findByRole("button", { name: "Delete pickup: School pickup" }),
  );
  const dialog = screen.getByRole("alertdialog");
  await user.click(
    within(dialog).getByRole("button", { name: "Delete pickup" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    pickupsMessages.en.deleteFailed,
  );
  failRefresh = true;
  await user.click(
    within(dialog).getByRole("button", { name: "Refresh pickups" }),
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Refresh pickups" }),
    ).toBeEnabled(),
  );
  expect(screen.getByRole("alertdialog")).toBeVisible();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
});

it("never offers deletion without the parent presentation capability", async () => {
  mockCanManage = false;
  global.fetch = jest.fn(async (input: RequestInfo | URL) =>
    String(input) === "/api/pickups"
      ? response({ pickups: [futurePickup] })
      : response({ members: [] }),
  ) as unknown as typeof fetch;
  renderPage();
  await screen.findByRole("checkbox");
  expect(
    screen.queryByRole("button", { name: /Delete pickup/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
});

it("handles both pickup and member loading failures without losing the draft on retry", async () => {
  let membersCalls = 0;
  let pickupCalls = 0;
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/pickups") {
      pickupCalls += 1;
      return pickupCalls === 1
        ? response({}, false)
        : response({ pickups: [] });
    }
    membersCalls += 1;
    return membersCalls === 1
      ? response({}, false)
      : response({ members: [{ id: "member-1", name: "Sam" }] });
  }) as unknown as typeof fetch;
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole("button", { name: "Add" }));
  const dialog = screen.getByRole("dialog", { name: "New pickup" });
  await user.type(within(dialog).getByLabelText("Title"), "Library pickup");
  expect(within(dialog).getByRole("combobox")).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  await user.click(
    within(dialog).getByRole("button", { name: "Reload family members" }),
  );
  await waitFor(() =>
    expect(within(dialog).getByRole("combobox")).toBeEnabled(),
  );
  expect(within(dialog).getByLabelText("Title")).toHaveValue("Library pickup");
  expect(
    within(dialog).getByRole("option", { name: "Sam" }),
  ).toBeInTheDocument();
});
