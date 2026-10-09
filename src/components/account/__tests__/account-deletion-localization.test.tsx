/** @jest-environment jsdom */
import * as React from "react";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import DeleteAccountDialog from "../DeleteAccountDialog";
import LazyDeleteAccountDialog from "../LazyDeleteAccountDialog";
import { downloadMyData } from "@/lib/data-export-client";
import type { DeletionOptions } from "@/lib/account-deletion-shared";
const mockLoad = jest.fn();
jest.mock("../load-delete-account-dialog", () => ({
  loadDeleteAccountDialog: () => mockLoad(),
}));
jest.mock("@/lib/data-export-client", () => ({ downloadMyData: jest.fn() }));
const options: DeletionOptions = {
  role: "teen",
  household: {
    id: "fixture-family",
    name: "Synthetic {name} 李",
    memberCount: 4,
    parentCount: 1,
  },
  isOnlyParent: false,
  canDeleteAccount: true,
  canDeleteHousehold: false,
};
const json = (status: number, body: unknown) =>
  ({ ok: status < 300, status, json: async () => body }) as Response;
let change: (locale: "en" | "es") => void;
function Control() {
  change = useTranslation().setLocale;
  return null;
}
function mount(node: React.ReactNode, locale: "en" | "es" = "en") {
  return render(
    <I18nProvider locale={locale}>
      <Control />
      {node}
    </I18nProvider>,
  );
}
function api(
  value = options,
  deletes: Array<Response | Error | Promise<Response>> = [],
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (init?.method !== "DELETE") return json(200, value);
    const next = deletes.shift() ?? json(500, {});
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return calls;
}
beforeEach(() => jest.clearAllMocks());
it("keeps drafts, exact pending body/key and focused input across language changes; late failure uses current language", async () => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((r) => (resolve = r));
  const calls = api(options, [pending]);
  mount(<DeleteAccountDialog open onClose={jest.fn()} onDeleted={jest.fn()} />);
  const password = await screen.findByLabelText("Your password");
  const confirmation = screen.getByLabelText(/to confirm/);
  fireEvent.change(password, { target: { value: "fabricated-password" } });
  fireEvent.change(confirmation, { target: { value: "DELETE" } });
  password.focus();
  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  const request = calls[1].init!;
  expect(JSON.parse(String(request.body))).toEqual({
    password: "fabricated-password",
    confirmation: "DELETE",
  });
  expect(
    (request.headers as Record<string, string>)["Idempotency-Key"],
  ).toBeTruthy();
  act(() => change("es"));
  expect(screen.getByRole("dialog", { name: "Eliminar cuenta" })).toBeVisible();
  expect(screen.getByLabelText("Tu contraseña")).toBe(password);
  expect(password).toHaveValue("fabricated-password");
  expect(confirmation).toHaveValue("DELETE");
  expect(password).toHaveFocus();
  expect(calls).toHaveLength(2);
  await act(async () => resolve(json(500, {})));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Algo salió mal. No se eliminó nada.",
  );
  act(() => change("en"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Something went wrong. Nothing was deleted.",
  );
  expect(calls).toHaveLength(2);
});
it("localizes unknown-outcome feedback without losing the same retry key across dismissal", async () => {
  const calls = api(options, [
    new Error("fixture offline"),
    new Error("fixture offline"),
    json(401, {}),
  ]);
  const deleted = jest.fn();
  const view = mount(
    <DeleteAccountDialog open onClose={jest.fn()} onDeleted={deleted} />,
  );
  fireEvent.change(await screen.findByLabelText("Your password"), {
    target: { value: "fixture-password" },
  });
  fireEvent.change(screen.getByLabelText(/to confirm/), {
    target: { value: "DELETE" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  await screen.findByRole("alert");
  act(() => change("es"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Sin conexión. Comprueba tu conexión e inténtalo de nuevo.",
  );
  const node = (open: boolean) => (
    <I18nProvider>
      <Control />
      <DeleteAccountDialog
        open={open}
        onClose={jest.fn()}
        onDeleted={deleted}
      />
    </I18nProvider>
  );
  view.rerender(node(false));
  view.rerender(node(true));
  const password = await screen.findByLabelText("Tu contraseña");
  fireEvent.change(password, { target: { value: "fixture-password" } });
  fireEvent.change(screen.getByLabelText(/Escribe DELETE/), {
    target: { value: "DELETE" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Eliminar mi cuenta" }));
  await waitFor(() => expect(deleted).toHaveBeenCalledWith("account"));
  const keys = calls
    .filter((c) => c.init?.method === "DELETE")
    .map((c) => (c.init!.headers as Record<string, string>)["Idempotency-Key"]);
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(1);
});
it("localizes lazy module retry without reloading on locale change or losing keyboard focus", async () => {
  mockLoad.mockRejectedValueOnce(new Error("fixture chunk"));
  mockLoad.mockResolvedValueOnce(() => <p>Fixture controls</p>);
  mount(<LazyDeleteAccountDialog open onClose={jest.fn()} />);
  await screen.findByRole("alert");
  const retry = screen.getByRole("button", { name: "Try again" });
  retry.focus();
  act(() => change("es"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "No se pudieron cargar los detalles de tu cuenta.",
  );
  expect(screen.getByRole("button", { name: "Intentar de nuevo" })).toBe(retry);
  expect(retry).toHaveFocus();
  expect(mockLoad).toHaveBeenCalledTimes(1);
  fireEvent.click(retry);
  await screen.findByText("Fixture controls");
  expect(mockLoad).toHaveBeenCalledTimes(2);
});
it("keeps private household name and plural warning exact, and never accepts a translated DELETE token", async () => {
  api({
    ...options,
    role: "parent",
    isOnlyParent: true,
    canDeleteAccount: false,
    canDeleteHousehold: true,
  });
  mount(<DeleteAccountDialog open onClose={jest.fn()} />, "es");
  const password = await screen.findByLabelText("Tu contraseña");
  expect(
    screen.getByRole("dialog", { name: "Eliminar hogar" }),
  ).toHaveTextContent("las 4 cuentas");
  expect(screen.getAllByText(options.household!.name)).toHaveLength(2);
  fireEvent.change(password, { target: { value: "fixture-password" } });
  const confirmation = screen.getByLabelText(/Escribe el nombre del hogar/);
  fireEvent.change(confirmation, { target: { value: "ELIMINAR" } });
  expect(screen.getByRole("button", { name: "Eliminar hogar" })).toBeDisabled();
  fireEvent.change(confirmation, {
    target: { value: options.household!.name },
  });
  expect(screen.getByRole("button", { name: "Eliminar hogar" })).toBeEnabled();
});
it("shows late export progress and result in the current language without a second export", async () => {
  api();
  let finish!: () => void;
  (downloadMyData as jest.Mock).mockImplementationOnce(
    () => new Promise<void>((r) => (finish = r)),
  );
  mount(<DeleteAccountDialog open onClose={jest.fn()} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Download my data" }),
  );
  act(() => change("es"));
  expect(screen.getByRole("button", { name: "Preparando…" })).toBeDisabled();
  await act(async () => finish());
  expect(screen.getByText("Tu descarga ha comenzado.")).toBeVisible();
  expect(downloadMyData).toHaveBeenCalledTimes(1);
  (downloadMyData as jest.Mock).mockRejectedValueOnce(
    new Error("fixture export failed"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Descargar mis datos" }));
  await screen.findByText("La descarga no funcionó. Inténtalo de nuevo.");
  act(() => change("en"));
  expect(
    screen.getByText("The download did not work. Try again."),
  ).toBeVisible();
  expect(downloadMyData).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([
  ["raw top-level refusal", { error: "Synthetic {key} / 李 server refusal" }],
  [
    "raw nested refusal",
    { error: { message: "Synthetic {key} / 李 server refusal" } },
  ],
])("preserves %s exactly across locale changes", async (_label, response) => {
  api(options, [json(400, response)]);
  mount(<DeleteAccountDialog open onClose={jest.fn()} />);
  fireEvent.change(await screen.findByLabelText("Your password"), {
    target: { value: "fixture-password" },
  });
  fireEvent.change(screen.getByLabelText(/to confirm/), {
    target: { value: "DELETE" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  await screen.findByRole("alert");
  act(() => change("es"));
  expect(screen.getByRole("alert").textContent).toBe(
    "Synthetic {key} / 李 server refusal",
  );
});
it("keeps first-attempt session failure distinct from same-key completion and refreshes its presentation", async () => {
  api(options, [json(401, {})]);
  const deleted = jest.fn();
  mount(<DeleteAccountDialog open onClose={jest.fn()} onDeleted={deleted} />);
  fireEvent.change(await screen.findByLabelText("Your password"), {
    target: { value: "fixture-password" },
  });
  fireEvent.change(screen.getByLabelText(/to confirm/), {
    target: { value: "DELETE" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  await screen.findByRole("alert");
  act(() => change("es"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Tu sesión ha terminado.",
  );
  expect(deleted).not.toHaveBeenCalled();
});
it.each([true, false])(
  "localizes the blocked only-parent=%s state without offering household controls",
  async (isOnlyParent) => {
    api({
      ...options,
      isOnlyParent,
      canDeleteAccount: false,
      canDeleteHousehold: true,
    });
    mount(
      <DeleteAccountDialog open onClose={jest.fn()} allowHousehold={false} />,
      "es",
    );
    await screen.findByText(
      isOnlyParent
        ? "Eres el único progenitor de este hogar. Elimina el hogar desde Ajustes."
        : "Eres el último miembro de este hogar. Pide a un progenitor que elimine el hogar.",
    );
    expect(screen.queryByLabelText("Tu contraseña")).toBeNull();
    expect(screen.queryByRole("button", { name: "Eliminar hogar" })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it("requires the canonical DELETE token for the Spanish own-account flow", async () => {
  api();
  mount(<DeleteAccountDialog open onClose={jest.fn()} />, "es");
  fireEvent.change(await screen.findByLabelText("Tu contraseña"), {
    target: { value: "fixture-password" },
  });
  const field = screen.getByLabelText(/Escribe DELETE/);
  fireEvent.change(field, { target: { value: "ELIMINAR" } });
  expect(
    screen.getByRole("button", { name: "Eliminar mi cuenta" }),
  ).toBeDisabled();
  fireEvent.change(field, { target: { value: "delete" } });
  expect(
    screen.getByRole("button", { name: "Eliminar mi cuenta" }),
  ).toBeEnabled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("retains an empty raw refusal without introducing an empty alert", async () => {
  api(options, [json(400, { error: "" })]);
  mount(<DeleteAccountDialog open onClose={jest.fn()} />);
  fireEvent.change(await screen.findByLabelText("Your password"), {
    target: { value: "fixture-password" },
  });
  fireEvent.change(screen.getByLabelText(/to confirm/), {
    target: { value: "DELETE" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Delete my account" }),
    ).toBeEnabled(),
  );
  act(() => change("es"));
  expect(screen.queryByRole("alert")).toBeNull();
});
