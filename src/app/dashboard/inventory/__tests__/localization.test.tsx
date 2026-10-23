/** @jest-environment jsdom */
import {
  inventoryReadScopeValue,
  INVENTORY_READ_SCOPE_HEADER,
} from "@/lib/inventory-read-scope";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import { ToastProvider } from "@/components/ui/toast";
import InventoryClient from "../InventoryClient";
import { toDateOnlyLocal } from "@/lib/dates";
import { IDEMPOTENCY_HEADER } from "@/lib/idempotency-key";
jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => false,
}));
const name = "Synthetic {name} 李";
const unit = "raw {unit} 李";
const item = {
  id: "synthetic+item",
  name,
  amount: 2,
  unit,
  location: "fridge",
  expires_on: "2026-10-10",
  date_kind: "best_before",
  category: "produce",
  purchased_on: null,
  opened_on: null,
  status: "active",
  updated_at: "2026-01-01T00:00:00.000Z",
  expiry: { status: "soon", daysLeft: 1 },
};
function Switch() {
  const { locale, setLocale } = useTranslation();
  return (
    <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>
      Switch language
    </button>
  );
}
function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === INVENTORY_READ_SCOPE_HEADER.toLowerCase()
          ? inventoryReadScopeValue({
              userId: "fixture-parent",
              familyId: "fixture-family",
            })
          : null,
    },
  } as Response;
}
function deferred() {
  let resolve!: (r: Response) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<Response>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Call = {
  url: string;
  method: string;
  body: unknown;
  headers?: HeadersInit;
};
function mount({
  empty = false,
  create,
  adjust,
}: {
  empty?: boolean;
  create?: () => Promise<Response> | Response;
  adjust?: () => Promise<Response> | Response;
} = {}) {
  const calls: Call[] = [];
  global.fetch = jest.fn(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      headers: init?.headers,
    });
    if (method !== "GET") {
      if (url === "/api/inventory/change") {
        const operation = JSON.parse(String(init?.body)).operation;
        if (operation.kind === "edit" || operation.kind === "remove")
          return json(200, { itemId: operation.item_id, kind: operation.kind });
        return (
          adjust?.() ??
          json(200, {
            itemId: item.id,
            adjustmentId:
              operation.kind === "undo"
                ? operation.adjustment_id
                : "synthetic+adjust",
            kind: operation.kind,
          })
        );
      }
      return create?.() ?? json(201, { itemId: item.id });
    }
    if (url.includes("/use-soon?"))
      return json(200, {
        items: empty
          ? []
          : [
              {
                ...item,
                itemId: item.id,
                expiresOn: item.expires_on,
                dateKind: item.date_kind,
                status: "soon",
                daysLeft: 1,
              },
            ],
      });
    if (url.includes("/adjustments?")) return json(200, { adjustments: [] });
    return json(200, { items: empty ? [] : [item], nextOffset: null });
  });
  const view = render(
    <I18nProvider locale="en">
      <Switch />
      <ToastProvider>
        <InventoryClient
          canWrite
          canOpenRecipes={false}
          canScan
          intakeContext={{
            userId: "fixture-parent",
            familyId: "fixture-family",
          }}
        />
      </ToastProvider>
    </I18nProvider>,
  );
  return { ...view, calls };
}
async function settle() {
  await act(async () => {});
}
function switchLanguage() {
  fireEvent.click(screen.getByText("Switch language"));
}
beforeEach(() => {
  window.history.replaceState({}, "", "/dashboard/inventory");
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
});
afterEach(() => {
  jest.useRealTimers();
});
it("updates labels without another load, preserving filter values, selected canonical enums and focus", async () => {
  const { calls } = mount();
  await settle();
  const search = screen.getByRole("searchbox");
  fireEvent.change(search, { target: { value: "Synthetic" } });
  search.focus();
  const where = screen.getByRole("combobox", { name: "Where" });
  fireEvent.change(where, { target: { value: "fridge" } });
  const count = calls.length;
  switchLanguage();
  expect(
    screen.getByRole("heading", { name: "Inventario de alimentos" }),
  ).toBeInTheDocument();
  expect(search).toHaveFocus();
  expect(search).toHaveValue("Synthetic");
  expect(where).toHaveValue("fridge");
  expect(screen.getByRole("combobox", { name: "Dónde" })).toBe(where);
  expect(screen.getAllByText(name).length).toBeGreaterThan(0);
  const shortcuts = screen.getByTestId("inventory-shortcuts");
  expect(
    within(shortcuts).getByRole("button", { name: "Refrigerador 1 alimento" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    within(shortcuts).getByRole("heading", { name: "Ubicaciones" }),
  ).toBeInTheDocument();
  expect(calls).toHaveLength(count);
});
it("preserves modal drafts/private values/date keys while translating visible validation without a write", async () => {
  const { calls } = mount({ empty: true });
  await settle();
  fireEvent.click(screen.getAllByRole("button", { name: "Add item" })[0]);
  const modal = screen.getByRole("dialog");
  fireEvent.change(within(modal).getByLabelText(/Unit/), {
    target: { value: unit },
  });
  fireEvent.click(within(modal).getByRole("button", { name: "Save" }));
  expect(within(modal).getByRole("alert")).toHaveTextContent("Enter a name.");
  switchLanguage();
  expect(within(modal).getByRole("alert")).toHaveTextContent(
    "Escribe un nombre.",
  );
  expect(within(modal).getByLabelText(/Unidad/)).toHaveValue(unit);
  expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
});
it.each(["fallback", "network", "raw"] as const)(
  "renders late %s in current language and preserves uncertain create ownership",
  async (outcome) => {
    const p = deferred();
    let attempt = 0;
    const { calls } = mount({
      empty: true,
      create: () => (attempt++ === 0 ? p.promise : json(400, {})),
    });
    await settle();
    fireEvent.click(screen.getAllByRole("button", { name: "Add item" })[0]);
    const modal = screen.getByRole("dialog");
    fireEvent.change(within(modal).getByLabelText("Name"), {
      target: { value: name },
    });
    fireEvent.change(within(modal).getByLabelText(/Unit/), {
      target: { value: unit },
    });
    fireEvent.change(within(modal).getByLabelText(/Amount/), {
      target: { value: "1.5" },
    });
    fireEvent.click(within(modal).getByRole("button", { name: "Save" }));
    switchLanguage();
    expect(
      within(modal).getByRole("button", { name: "Guardando…" }),
    ).toBeDisabled();
    await act(async () =>
      outcome === "network"
        ? p.reject(new Error("synthetic network"))
        : p.resolve(
            json(
              400,
              outcome === "raw"
                ? { error: { message: "Raw refusal {name} 李" } }
                : {},
            ),
          ),
    );
    expect(within(modal).getByRole("alert")).toHaveTextContent(
      outcome === "network"
        ? "Guardado sin confirmar. Tus datos están bloqueados. Comprueba el mismo guardado antes de salir o volver a añadirlo."
        : "Guardado rechazado. Revisa tu cuenta, hogar y acceso al inventario. Se conserva el borrador.",
    );
    expect(within(modal).getByLabelText("Nombre")).toHaveValue(name);
    // The refusal releases its pending navigation claim before enabling Save.
    const retry = await within(modal).findByRole("button", {
      name: outcome === "network" ? "Comprobar mismo guardado" : "Guardar",
    });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await settle();
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes).toHaveLength(2);
    if (outcome !== "network")
      await waitFor(() =>
        expect(
          within(modal).getByRole("button", { name: "Guardar" }),
        ).toBeEnabled(),
      );
    if (outcome === "network") expect(writes[0]).toEqual(writes[1]);
    expect(writes[0].url).toBe("/api/inventory/intake");
    expect((writes[0].body as { item: unknown }).item).toEqual({
      name,
      unit,
      amount: 1.5,
      location: "fridge",
      expires_on: null,
      date_kind: "best_before",
      category: null,
      purchased_on: null,
      opened_on: null,
    });
    expect(
      (writes[0].headers as Record<string, string>)[IDEMPOTENCY_HEADER],
    ).toBeTruthy();
  },
);
it("updates owned success notice and undo title/action without reloading, replaying or changing its eight-second timer", async () => {
  jest.useFakeTimers();
  const { calls } = mount();
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Used " + name }));
  await settle();
  const toast = await screen.findByTestId("undo-toast");
  expect(toast).toHaveTextContent("Used " + name);
  act(() => jest.advanceTimersByTime(4000));
  const count = calls.length;
  switchLanguage();
  expect(screen.getByTestId("undo-toast")).toBe(toast);
  expect(toast).toHaveTextContent("Usaste " + name);
  expect(
    within(toast).getByRole("button", { name: "Deshacer" }),
  ).toBeInTheDocument();
  expect(
    within(toast).getByRole("button", { name: "Descartar aviso" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("inventory-notice")).toHaveTextContent(
    "Se confirmó el cambio registrado de " +
      name +
      ". La lista muestra las existencias actuales.",
  );
  expect(calls).toHaveLength(count);
  act(() => jest.advanceTimersByTime(3999));
  expect(toast).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
});
it("keeps native focus, paused undo and its canonical callback through a locale change", async () => {
  jest.useFakeTimers();
  const { calls } = mount();
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Used " + name }));
  await settle();
  const toast = await screen.findByTestId("undo-toast");
  const undo = within(toast).getByRole("button", { name: "Undo" });
  act(() => undo.focus());
  act(() => jest.advanceTimersByTime(9000));
  switchLanguage();
  expect(within(toast).getByRole("button", { name: "Deshacer" })).toBe(undo);
  expect(undo).toHaveFocus();
  fireEvent.click(undo);
  await settle();
  expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
  const undos = calls.filter(
    (c) =>
      c.url === "/api/inventory/change" &&
      (c.body as any).operation.kind === "undo",
  );
  expect(undos).toHaveLength(1);
  expect(undos[0].url).toBe("/api/inventory/change");
  expect(undos[0].method).toBe("POST");
  expect((undos[0].body as any).operation).toEqual({
    kind: "undo",
    adjustment_id: "synthetic+adjust",
  });
  await waitFor(() =>
    expect(screen.getByTestId("inventory-notice")).toHaveTextContent(
      "Se repuso " + name + ".",
    ),
  );
});
