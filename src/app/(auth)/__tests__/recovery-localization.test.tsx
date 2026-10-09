/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ForgotPasswordPage from "../forgot-password/page";
import ResetPasswordPage from "../reset-password/page";
import { I18nProvider, useTranslation } from "@/i18n";

const mockPush = jest.fn();
let mockToken: string | null = "synthetic-token-only";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () =>
    new URLSearchParams(mockToken ? { token: mockToken } : {}),
}));
function LocaleSwitch() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Switch language</button>;
}
function mount(page: React.ReactNode) {
  return render(
    <I18nProvider>
      <LocaleSwitch />
      {page}
    </I18nProvider>,
  );
}
function response(ok: boolean, data: unknown = {}) {
  return { ok, json: async () => data } as Response;
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
  mockToken = "synthetic-token-only";
  mockPush.mockReset();
  global.fetch = jest.fn();
});

it("renders neutral success in the mounted language with the private email exact", async () => {
  const pending = deferred();
  (fetch as jest.Mock).mockReturnValue(pending.promise);
  const { container } = mount(<ForgotPasswordPage />);
  const email = screen.getByLabelText("Email Address");
  fireEvent.change(email, { target: { value: "Private+QA@example.test" } });
  email.focus();
  fireEvent.submit(container.querySelector("form")!);
  fireEvent.click(screen.getByText("Switch language"));
  expect(email).toHaveValue("Private+QA@example.test");
  expect(email).toHaveFocus();
  expect(screen.getByRole("button", { name: "Enviando..." })).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "Private+QA@example.test" }),
  });
  await act(async () => pending.resolve(response(true)));
  expect(
    screen.getByRole("heading", { name: "Revisa tu correo" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Private+QA@example.test")).toHaveClass(
    "font-medium",
  );
  expect(screen.getByText(/Si existe una cuenta con/)).toHaveTextContent(
    "Private+QA@example.test",
  );
  expect(
    screen.getByRole("link", { name: "Volver a iniciar sesion" }),
  ).toHaveAttribute("href", "/login");
});
it("renders a late owned network error in the current language without resubmitting", async () => {
  const pending = deferred();
  (fetch as jest.Mock).mockReturnValue(pending.promise);
  const { container } = mount(<ForgotPasswordPage />);
  fireEvent.change(screen.getByLabelText("Email Address"), {
    target: { value: "qa@example.test" },
  });
  fireEvent.submit(container.querySelector("form")!);
  fireEvent.click(screen.getByText("Switch language"));
  await act(async () => pending.reject(new Error("synthetic network drop")));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Ocurrio un error inesperado",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("updates already-visible owned fallback feedback after language changes", async () => {
  (fetch as jest.Mock).mockResolvedValue(response(false));
  const { container } = mount(<ForgotPasswordPage />);
  fireEvent.submit(container.querySelector("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "An error occurred",
  );
  fireEvent.click(screen.getByText("Switch language"));
  expect(screen.getByRole("alert")).toHaveTextContent("Ocurrio un error");
});
it("preserves raw recovery refusal and form draft across locale changes", async () => {
  (fetch as jest.Mock).mockResolvedValue(
    response(false, { error: "Raw private refusal • exact" }),
  );
  const { container } = mount(<ForgotPasswordPage />);
  fireEvent.change(screen.getByLabelText("Email Address"), {
    target: { value: "qa@example.test" },
  });
  fireEvent.submit(container.querySelector("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Raw private refusal • exact",
  );
  fireEvent.click(screen.getByText("Switch language"));
  expect(screen.getByRole("alert").textContent).toBe(
    "Raw private refusal • exact",
  );
  expect(screen.getByLabelText("Correo electronico")).toHaveValue(
    "qa@example.test",
  );
});
it("keeps reset drafts, visibility, focus, canonical token and exact body while pending", async () => {
  const pending = deferred();
  (fetch as jest.Mock).mockReturnValue(pending.promise);
  const { container } = mount(<ResetPasswordPage />);
  const password = screen.getByLabelText("Password", { exact: true });
  const confirm = screen.getByLabelText("Confirm Password");
  fireEvent.change(password, { target: { value: "synthetic-password" } });
  fireEvent.change(confirm, { target: { value: "synthetic-password" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Show password" })[0]);
  confirm.focus();
  fireEvent.submit(container.querySelector("form")!);
  fireEvent.click(screen.getByText("Switch language"));
  expect(password).toHaveValue("synthetic-password");
  expect(password).toHaveAttribute("type", "text");
  expect(confirm).toHaveValue("synthetic-password");
  expect(confirm).toHaveFocus();
  expect(
    screen.getByRole("button", { name: "Ocultar contraseña" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Mostrar contraseña" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Restableciendo..." }),
  ).toBeDisabled();
  expect(fetch).toHaveBeenCalledWith("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: "synthetic-token-only",
      password: "synthetic-password",
    }),
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(response(true)));
  expect(
    screen.getByText("Tu contraseña se ha restablecido correctamente."),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Iniciar sesion" }));
  expect(mockPush).toHaveBeenCalledWith("/login");
});
it("announces existing mismatch validation and re-renders it without changing drafts", () => {
  const { container } = mount(<ResetPasswordPage />);
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
    target: { value: "synthetic-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm Password"), {
    target: { value: "different-password" },
  });
  fireEvent.submit(container.querySelector("form")!);
  expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match");
  fireEvent.click(screen.getByText("Switch language"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Las contrasenas no coinciden",
  );
  expect(screen.getByLabelText("Confirmar contrasena")).toHaveValue(
    "different-password",
  );
  expect(fetch).not.toHaveBeenCalled();
});
it("localizes invalid link presentation without requesting or altering navigation", () => {
  mockToken = null;
  mount(<ResetPasswordPage />);
  fireEvent.click(screen.getByText("Switch language"));
  expect(
    screen.getByRole("heading", { name: "Enlace no válido" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Enviar enlace" })).toHaveAttribute(
    "href",
    "/forgot-password",
  );
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["network", "fallback", "raw"] as const)(
  "keeps late reset %s feedback and exact drafts while language changes",
  async (kind) => {
    const pending = deferred();
    (fetch as jest.Mock).mockReturnValue(pending.promise);
    const { container } = mount(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
      target: { value: "synthetic-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm Password"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.submit(container.querySelector("form")!);
    fireEvent.click(screen.getByText("Switch language"));
    await act(async () => {
      if (kind === "network")
        pending.reject(new Error("synthetic dropped reset"));
      else
        pending.resolve(
          response(
            false,
            kind === "raw" ? { error: "Raw refusal {token} • exact" } : {},
          ),
        );
    });
    const expected =
      kind === "network"
        ? "Ocurrio un error inesperado"
        : kind === "raw"
          ? "Raw refusal {token} • exact"
          : "Ocurrio un error";
    expect(screen.getByRole("alert").textContent).toBe(expected);
    expect(screen.getByLabelText("Contrasena", { exact: true })).toHaveValue(
      "synthetic-password",
    );
    expect(screen.getByLabelText("Confirmar contrasena")).toHaveValue(
      "synthetic-password",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it("retains the existing eight-character validation without sending a short password", () => {
  const { container } = mount(<ResetPasswordPage />);
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
    target: { value: "short" },
  });
  fireEvent.change(screen.getByLabelText("Confirm Password"), {
    target: { value: "short" },
  });
  fireEvent.submit(container.querySelector("form")!);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Password must be at least 8 characters long",
  );
  fireEvent.click(screen.getByText("Switch language"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "La contrasena debe tener al menos 8 caracteres",
  );
  expect(fetch).not.toHaveBeenCalled();
});
