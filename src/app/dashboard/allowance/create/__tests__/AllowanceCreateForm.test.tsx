/** @jest-environment jsdom */

import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import AllowanceCreateForm from "../AllowanceCreateForm";
import type { ComponentProps } from "react";

const push = jest.fn();
const refresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ back: jest.fn(), push, refresh }),
}));

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

function renderForm(props: ComponentProps<typeof AllowanceCreateForm> = {}) {
  return render(
    <I18nProvider locale="en">
      <AllowanceCreateForm {...props} />
    </I18nProvider>,
  );
}

function roster() {
  return response({
    members: [{ id: "child-a", name: "Sam", avatar_url: null }],
  });
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
});

it("keeps the draft through a malformed roster response and retry", async () => {
  const user = userEvent.setup();
  let attempts = 0;
  global.fetch = jest.fn(async (url: string) => {
    if (url !== "/api/family/members") return response({});
    attempts += 1;
    return attempts === 1
      ? response({ members: [{ id: "missing-name" }] })
      : roster();
  }) as unknown as typeof fetch;

  renderForm();
  await screen.findByText("Couldn't load family members. Try again.");
  await user.type(screen.getByLabelText("Amount"), "10.00");
  await user.type(screen.getByLabelText("Reason"), "Weekly allowance");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("option", { name: "Sam" });
  expect(screen.getByLabelText("Amount")).toHaveValue(10);
  expect(screen.getByLabelText("Reason")).toHaveValue("Weekly allowance");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("For"), "child-a");
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

it("reuses one key after a committed lost response and validates the returned allowance id", async () => {
  const user = userEvent.setup();
  const keys: string[] = [];
  const rows: Array<{ id: string; reason: string | null }> = [];
  let postCount = 0;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/family/members") return roster();
    if (url !== "/api/allowance") return response({});
    postCount += 1;
    const key = new Headers(init?.headers).get("Idempotency-Key");
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    keys.push(key!);
    const payload = JSON.parse(String(init?.body)) as { reason: string | null };
    if (postCount === 1) {
      rows.push({ id: "allowance-1", reason: payload.reason });
      throw new TypeError("lost response");
    }
    return response({ allowance: { id: rows[0]?.id } });
  }) as unknown as typeof fetch;

  renderForm();
  await screen.findByRole("option", { name: "Sam" });
  await user.selectOptions(screen.getByLabelText("For"), "child-a");
  await user.type(screen.getByLabelText("Amount"), "10");
  await user.type(screen.getByLabelText("Reason"), "Weekly allowance");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Amount")).toHaveValue(10);
  expect(screen.getByLabelText("Reason")).toHaveValue("Weekly allowance");

  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("/dashboard/allowance"),
  );
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(rows).toEqual([{ id: "allowance-1", reason: "Weekly allowance" }]);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("keeps a malformed 2xx retryable and gives a changed intent a new key", async () => {
  const user = userEvent.setup();
  const keys: string[] = [];
  let postCount = 0;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/family/members") return roster();
    if (url !== "/api/allowance") return response({});
    postCount += 1;
    keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
    return postCount < 3
      ? response({ created: true })
      : response({ allowance: { id: `allowance-${postCount}` } });
  }) as unknown as typeof fetch;

  renderForm();
  await screen.findByRole("option", { name: "Sam" });
  await user.selectOptions(screen.getByLabelText("For"), "child-a");
  await user.type(screen.getByLabelText("Amount"), "10");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  expect(keys[0]).toBe(keys[1]);
  await user.type(screen.getByLabelText("Reason"), "Changed intent");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  expect(keys[1]).not.toBe(keys[2]);
});

it("refuses child creation without fetching a roster", () => {
  global.fetch = jest.fn();
  renderForm({ canCreate: false });
  expect(screen.getByTestId("allowance-create-refused")).toBeInTheDocument();
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it("disables draft controls and blocks Escape while a sheet request is pending", async () => {
  const user = userEvent.setup();
  let release!: (value: Response) => void;
  global.fetch = jest.fn((url: string) => {
    if (url === "/api/family/members") return Promise.resolve(roster());
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  }) as unknown as typeof fetch;
  const onBusyChange = jest.fn();
  renderForm({ inSheet: true, onBusyChange });
  await screen.findByRole("option", { name: "Sam" });
  await user.selectOptions(screen.getByLabelText("For"), "child-a");
  await user.type(screen.getByLabelText("Amount"), "10");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByLabelText("For")).toBeDisabled();
  expect(screen.getByLabelText("Amount")).toBeDisabled();
  expect(screen.getByLabelText("Reason")).toBeDisabled();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  await user.keyboard("{Escape}");
  expect(screen.getByTestId("allowance-create-form")).toBeInTheDocument();
  await act(async () =>
    release(response({ allowance: { id: "allowance-1" } })),
  );
});
