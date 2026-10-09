/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import VerifyEmailPage from "../page";

const mockReplace = jest.fn();
let mockToken: string | null = "synthetic-{token}+ / 李";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () =>
    new URLSearchParams(mockToken === null ? {} : { token: mockToken }),
}));
function Switch() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Switch language</button>;
}
function mount() {
  return render(
    <I18nProvider locale="en">
      <Switch />
      <VerifyEmailPage />
    </I18nProvider>,
  );
}
function reply(status: number, body: unknown) {
  return { status, json: async () => body } as Response;
}
function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Response>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  mockToken = "synthetic-{token}+ / 李";
  mockReplace.mockReset();
  global.fetch = jest.fn();
});
it("does not consume a token on mount, language change or rerender; preserves focused canonical link", () => {
  const view = mount();
  const link = screen.getByRole("link", { name: "Go to sign in" });
  link.focus();
  fireEvent.click(screen.getByText("Switch language"));
  expect(
    screen.getByRole("heading", { name: "Confirma tu correo" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ir a iniciar sesión" })).toBe(link);
  expect(link).toHaveFocus();
  expect(link).toHaveAttribute("href", "/login");
  view.rerender(
    <I18nProvider locale="en">
      <Switch />
      <VerifyEmailPage />
    </I18nProvider>,
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});
it("keeps pending state and exact token body through a mounted locale change, then uses canonical success redirect", async () => {
  const p = deferred();
  (fetch as jest.Mock).mockReturnValue(p.promise);
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Confirm my email" }));
  fireEvent.click(screen.getByText("Switch language"));
  expect(screen.getByRole("button", { name: "Confirmando…" })).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: mockToken }),
  });
  await act(async () => p.resolve(reply(200, { status: "verified" })));
  expect(mockReplace).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith("/login?verified=1");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([
  [
    200,
    { status: "already_verified" },
    "status",
    "Tu correo ya está verificado. Puedes iniciar sesión.",
    false,
  ],
  [
    400,
    { error: "raw provider text must not leak" },
    "alert",
    'Ese enlace de verificación ha caducado o no es válido. Inicia sesión y elige "Reenviar correo de verificación" para obtener uno nuevo.',
    false,
  ],
  [
    429,
    {},
    "alert",
    "Demasiados intentos. Espera un poco e inténtalo de nuevo.",
    true,
  ],
  [
    503,
    {},
    "alert",
    "No pudimos confirmar tu correo ahora. Inténtalo de nuevo en un minuto.",
    true,
  ],
  [
    200,
    { status: "unknown" },
    "alert",
    "No pudimos confirmar tu correo ahora. Inténtalo de nuevo en un minuto.",
    true,
  ],
])(
  "renders late outcome %s in the current language and preserves retry policy",
  async (status, body, role, text, retry) => {
    const p = deferred();
    (fetch as jest.Mock).mockReturnValue(p.promise);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Confirm my email" }));
    fireEvent.click(screen.getByText("Switch language"));
    await act(async () => p.resolve(reply(Number(status), body)));
    expect(screen.getByRole(String(role))).toHaveTextContent(String(text));
    expect(
      !!screen.queryByRole("button", { name: "Confirmar mi correo" }),
    ).toBe(retry);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(
      screen.queryByText("raw provider text must not leak"),
    ).not.toBeInTheDocument();
  },
);
it("updates an already-visible semantic notice without retrying", async () => {
  (fetch as jest.Mock).mockResolvedValue(reply(429, {}));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Confirm my email" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByText("Switch language"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Demasiados intentos. Espera un poco e inténtalo de nuevo.",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("keeps the explicit retry after network and malformed JSON failures", async () => {
  const p = deferred();
  (fetch as jest.Mock).mockReturnValueOnce(p.promise).mockResolvedValueOnce({
    status: 200,
    json: async () => {
      throw new SyntaxError("synthetic JSON error");
    },
  });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Confirm my email" }));
  fireEvent.click(screen.getByText("Switch language"));
  await act(async () => p.reject(new TypeError("synthetic network error")));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "No pudimos confirmar tu correo ahora.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirmar mi correo" }));
  await act(async () => {});
  expect(screen.getByRole("alert")).toHaveTextContent(
    "No pudimos confirmar tu correo ahora.",
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [, init] of (fetch as jest.Mock).mock.calls)
    expect(JSON.parse(init.body)).toEqual({ token: mockToken });
  expect(mockReplace).not.toHaveBeenCalled();
});
it("keeps missing-token guidance and no confirm action after language changes", () => {
  mockToken = null;
  mount();
  fireEvent.click(screen.getByText("Switch language"));
  expect(
    screen.getByText(
      "Ese enlace de verificación está incompleto. Copia el enlace completo del correo o inicia sesión para obtener uno nuevo.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Confirmar mi correo" }),
  ).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
