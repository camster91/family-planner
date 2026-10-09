/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
      if (url.includes("/consume?"))
        return (
          adjust?.() ??
          json(200, {
            item,
            adjustment: { id: "synthetic+adjust", status_after: "consumed" },
          })
        );
      if (url.includes("/undo?")) return json(200, {});
      return create?.() ?? json(201, { item });
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
        <InventoryClient canWrite canOpenRecipes={false} canScan />
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
  "renders late %s in current language and keeps the same retry key/body",
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
      outcome === "raw"
        ? "Raw refusal {name} 李"
        : outcome === "network"
          ? "No pudimos guardar. Revisa tu conexión e inténtalo de nuevo."
          : "No pudimos guardar. Inténtalo de nuevo.",
    );
    expect(within(modal).getByLabelText("Nombre")).toHaveValue(name);
    fireEvent.click(within(modal).getByRole("button", { name: "Guardar" }));
    await settle();
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(writes[1]);
    expect(writes[0].url).toBe(
      "/api/inventory?today=" + encodeURIComponent(toDateOnlyLocal(new Date())),
    );
    expect(writes[0].body).toEqual({
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
  const toast = screen.getByTestId("undo-toast");
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
    "Usaste " + name + ".",
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
  const toast = screen.getByTestId("undo-toast");
  const undo = within(toast).getByRole("button", { name: "Undo" });
  act(() => undo.focus());
  act(() => jest.advanceTimersByTime(9000));
  switchLanguage();
  expect(within(toast).getByRole("button", { name: "Deshacer" })).toBe(undo);
  expect(undo).toHaveFocus();
  fireEvent.click(undo);
  await settle();
  expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
  const undos = calls.filter((c) => c.url.includes("/undo?"));
  expect(undos).toHaveLength(1);
  expect(undos[0].url).toBe(
    "/api/inventory/adjustments/synthetic%2Badjust/undo?today=" +
      encodeURIComponent(toDateOnlyLocal(new Date())),
  );
  expect(undos[0].method).toBe("POST");
  expect(undos[0].body).toBeUndefined();
  expect(screen.getByTestId("inventory-notice")).toHaveTextContent(
    "Se repuso " + name + ".",
  );
});
