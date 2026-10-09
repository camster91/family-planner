/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import { ScanFridgeDialog } from "../ScanFridgeDialog";
import { IDEMPOTENCY_HEADER } from "@/lib/idempotency-key";
const privateName = "Synthetic {name} 李";
const suggestions = [
  {
    name: privateName,
    unit: "raw {unit} 李",
    amount: 2,
    location: "fridge",
    confidence: 0.95,
  },
  {
    name: "Synthetic second",
    amount: null,
    unit: "bag",
    location: "freezer",
    confidence: 0.6,
  },
];
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
    status,
    ok: status >= 200 && status < 300,
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
function mount() {
  const onDone = jest.fn();
  const onClose = jest.fn();
  render(
    <I18nProvider locale="en">
      <Switch />
      <ScanFridgeDialog onDone={onDone} onClose={onClose} />
    </I18nProvider>,
  );
  return { onDone, onClose };
}
function switchLanguage() {
  fireEvent.click(screen.getByText("Switch language"));
}
function upload() {
  fireEvent.change(screen.getByTestId("scan-file-input"), {
    target: {
      files: [
        new File(["synthetic image"], "synthetic.png", { type: "image/png" }),
      ],
    },
  });
}
beforeEach(() => {
  global.fetch = jest.fn();
});
it("translates initial privacy/brand/camera and close control without provider requests", () => {
  mount();
  switchLanguage();
  const dialog = screen.getByRole("dialog", {
    name: "Escanear el refrigerador",
  });
  expect(within(dialog).getByTestId("scan-privacy-note")).toHaveTextContent(
    "Anthropic",
  );
  expect(within(dialog).getByTestId("scan-privacy-note")).toHaveTextContent(
    "Herewoven",
  );
  expect(
    within(dialog).getByRole("button", { name: "Tomar o elegir una foto" }),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "Cerrar" }),
  ).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["disabled", "forbidden", "fallback", "network", "raw"] as const)(
  "uses current locale for delayed scan %s without rescan or transforming raw refusals",
  async (kind) => {
    const p = deferred();
    (fetch as jest.Mock).mockReturnValue(p.promise);
    mount();
    upload();
    await act(async () => {});
    switchLanguage();
    expect(screen.getByTestId("scan-loading")).toHaveTextContent(
      "Buscando alimentos en tu foto…",
    );
    await act(async () =>
      kind === "network"
        ? p.reject(new Error("synthetic network"))
        : p.resolve(
            json(
              kind === "disabled"
                ? 404
                : kind === "forbidden"
                  ? 403
                  : kind === "raw"
                    ? 429
                    : 503,
              kind === "raw" ? { error: "Raw refusal {name} 李" } : {},
            ),
          ),
    );
    const expected =
      kind === "raw"
        ? "Raw refusal {name} 李"
        : kind === "disabled"
          ? "El escaneo no está disponible ahora. Puedes añadir los alimentos a mano."
          : kind === "forbidden"
            ? "No puedes escanear el refrigerador. Pídele ayuda a un adulto."
            : kind === "network"
              ? "No pudimos contactar con el escáner. Revisa tu conexión e inténtalo de nuevo."
              : "Algo salió mal al escanear. Inténtalo de nuevo o añade los alimentos a mano.";
    expect(screen.getByTestId("scan-error")).toHaveTextContent(expected);
    const retry = screen.getByRole("button", { name: "Probar otra foto" });
    retry.focus();
    switchLanguage();
    expect(retry).toHaveFocus();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, init] = (fetch as jest.Mock).mock.calls[0];
    expect(path).toBe("/api/inventory/scan");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("image")).toBeTruthy();
  },
);
it("preserves private edited rows/canonical location/selection and stable keys through partial lost-response retry and locale changes", async () => {
  let n = 0;
  (fetch as jest.Mock).mockImplementation(async (path: string) =>
    path === "/api/inventory/scan"
      ? json(200, { items: suggestions })
      : ++n === 1
        ? json(201, {})
        : n === 2
          ? Promise.reject(new Error("synthetic lost response"))
          : json(201, {}),
  );
  const { onDone } = mount();
  upload();
  await act(async () => {});
  const first = screen.getAllByTestId("scan-suggestion")[0];
  const field = within(first).getByLabelText("Name");
  field.focus();
  switchLanguage();
  expect(within(first).getByLabelText("Nombre")).toBe(field);
  expect(field).toHaveFocus();
  expect(field).toHaveValue(privateName);
  expect(within(first).getByLabelText("Unidad")).toHaveValue("raw {unit} 李");
  expect(within(first).getByRole("combobox", { name: "Dónde" })).toHaveValue(
    "fridge",
  );
  expect(within(first).getByRole("checkbox")).toBeChecked();
  expect(within(first).getByTestId("scan-confidence")).toHaveTextContent(
    "Probable",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId("scan-add"));
  await act(async () => {});
  expect(screen.getAllByTestId("scan-suggestion")).toHaveLength(1);
  expect(onDone).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Se añadió 1 alimento. No se pudo añadir 1; revísalo e inténtalo de nuevo.",
  );
  switchLanguage();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Added 1 item. 1 couldn't be added; check it and try again.",
  );
  fireEvent.click(screen.getByTestId("scan-add"));
  await act(async () => {});
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(onDone).toHaveBeenCalledWith("Added 2 items from your photo.");
  const creates = (fetch as jest.Mock).mock.calls.slice(1);
  expect(JSON.parse(creates[0][1].body)).toEqual({
    name: privateName,
    unit: "raw {unit} 李",
    amount: 2,
    location: "fridge",
    expires_on: null,
  });
  expect(JSON.parse(creates[1][1].body)).toEqual(
    JSON.parse(creates[2][1].body),
  );
  expect(creates[1][1].headers[IDEMPOTENCY_HEADER]).toBe(
    creates[2][1].headers[IDEMPOTENCY_HEADER],
  );
  expect(creates[0][1].headers[IDEMPOTENCY_HEADER]).not.toBe(
    creates[1][1].headers[IDEMPOTENCY_HEADER],
  );
});
it("translates existing local row validation without losing drafts or creating requests", async () => {
  (fetch as jest.Mock).mockResolvedValue(json(200, { items: suggestions }));
  mount();
  upload();
  await act(async () => {});
  const first = screen.getAllByTestId("scan-suggestion")[0];
  fireEvent.change(within(first).getByLabelText("Name"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByTestId("scan-add"));
  switchLanguage();
  expect(within(first).getByTestId("scan-row-error")).toHaveTextContent(
    "Escribe un nombre.",
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Corrige los alimentos marcados y vuelve a añadirlos.",
  );
  expect(within(first).getByLabelText("Unidad")).toHaveValue("raw {unit} 李");
  expect(fetch).toHaveBeenCalledTimes(1);
});
