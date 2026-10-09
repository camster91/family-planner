/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider, useTranslation, messages } from "@/i18n";
import LoginPage from "../page";
import RegisterPage from "../../register/page";
const mockPush = jest.fn();
const mockRefresh = jest.fn();
const mockClear = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));
jest.mock("@/lib/offline-queue-browser", () => ({
  clearAllPersonQueues: () => mockClear(),
}));
function Switch() {
  const { locale, setLocale } = useTranslation();
  return (
    <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>
      Switch language
    </button>
  );
}
function mount(register = false) {
  return render(
    <I18nProvider locale="en">
      <Switch />
      {register ? <RegisterPage /> : <LoginPage />}
    </I18nProvider>,
  );
}
function reply(ok: boolean, body: unknown) {
  return { ok, json: async () => body } as Response;
}
function deferred() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const raw = {
  email: "synthetic@example.test",
  password: "synthetic-{password} 李",
  name: "Synthetic {name} 李",
};
function fill(
  container: HTMLElement,
  register = false,
  overrides: Record<string, string> = {},
) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  for (const [name, value] of Object.entries({
    email: raw.email,
    password: raw.password,
    ...(register ? { name: raw.name, confirmPassword: raw.password } : {}),
    ...overrides,
  }))
    setter.call(container.querySelector(`[name="${name}"]`), value);
  if (register) fireEvent.click(container.querySelector("#terms")!);
}
function switchLanguage() {
  fireEvent.click(screen.getByText("Switch language"));
}
beforeEach(() => {
  window.history.replaceState({}, "", "/login");
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockClear.mockReset();
  global.fetch = jest.fn();
});
it("keeps autofill, focus, revealed password and token link when switching, and clears queues only once", () => {
  window.history.replaceState(
    {},
    "",
    "/login?token=synthetic%2B%20%7Btoken%7D",
  );
  const { container } = mount();
  fill(container);
  const reveal = screen.getByRole("button", { name: "Show password" });
  fireEvent.click(reveal);
  reveal.focus();
  switchLanguage();
  expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toBe(
    reveal,
  );
  expect(reveal).toHaveFocus();
  expect(container.querySelector("#password")).toHaveAttribute("type", "text");
  expect(container.querySelector("#password")).toHaveValue(raw.password);
  expect(container.querySelector("#email")).toHaveValue(raw.email);
  expect(
    screen.getByRole("link", { name: messages.es.auth.signUp }),
  ).toHaveAttribute("href", "/register?token=synthetic%2B%20%7Btoken%7D");
  expect(mockClear).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["fallback", "network", "raw"] as const)(
  "login late %s feedback uses current language without changing raw refusals or resending",
  async (outcome) => {
    const p = deferred();
    (fetch as jest.Mock).mockReturnValue(p.promise);
    const { container } = mount();
    fill(container);
    fireEvent.submit(container.querySelector("form")!);
    switchLanguage();
    expect(
      screen.getByRole("button", { name: messages.es.auth.signingIn }),
    ).toBeDisabled();
    await act(async () =>
      outcome === "network"
        ? p.reject(new Error("synthetic network"))
        : p.resolve(
            reply(
              false,
              outcome === "raw" ? { error: "Raw refusal {email} 李" } : {},
            ),
          ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      outcome === "raw"
        ? "Raw refusal {email} 李"
        : messages.es.auth[
            outcome === "network" ? "unexpectedError" : "loginFailed"
          ],
    );
    switchLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent(
      outcome === "raw"
        ? "Raw refusal {email} 李"
        : messages.en.auth[
            outcome === "network" ? "unexpectedError" : "loginFailed"
          ],
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: raw.email, password: raw.password }),
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockClear).toHaveBeenCalledTimes(1);
  },
);
it.each([
  ["/login?redirect=%2Fcalendar%3Fx%3D1&token=synthetic", "/calendar?x=1"],
  [
    "/login?redirect=%2F%2Fevil.example&token=synthetic%2B",
    "/join?token=synthetic%2B",
  ],
  ["/login?redirect=%2F%2Fevil.example", "/dashboard"],
])(
  "keeps success routing for %s and clears arrival notices at submit",
  async (url, target) => {
    window.history.replaceState({}, "", url + "&verified=1&deleted=account");
    (fetch as jest.Mock).mockResolvedValue(reply(true, {}));
    const { container } = mount();
    fill(container);
    switchLanguage();
    expect(screen.getAllByRole("status")).toHaveLength(2);
    fireEvent.submit(container.querySelector("form")!);
    await act(async () => {});
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(target);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it.each([
  [
    "verified=1&error=server",
    "status",
    "Tu correo está verificado. Inicia sesión para empezar.",
  ],
  ["error=invalid_token", "alert", "Ese enlace de verificación ha caducado"],
  [
    "error=missing_token",
    "alert",
    "Ese enlace de verificación está incompleto",
  ],
  ["error=server", "alert", "No pudimos verificar tu correo ahora"],
  ["deleted=account", "status", "Tu cuenta ha sido eliminada."],
  [
    "deleted=household",
    "status",
    "Tu hogar y sus cuentas han sido eliminados.",
  ],
])(
  "translates mounted arrival %s without clearing again",
  (query, role, text) => {
    window.history.replaceState({}, "", "/login?" + query);
    mount();
    switchLanguage();
    expect(screen.getByRole(role)).toHaveTextContent(text);
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  },
);
it.each(["", "?error=unknown&deleted=unknown"])(
  "renders no invented arrival notice for %s",
  (suffix) => {
    window.history.replaceState({}, "", "/login" + suffix);
    mount();
    switchLanguage();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  },
);
it.each(["success", "refusal", "network"] as const)(
  "preserves login resend non-enumeration state after %s, without claiming delivery",
  async (outcome) => {
    const p = deferred();
    (fetch as jest.Mock)
      .mockResolvedValueOnce(
        reply(false, { error: "Please verify raw account" }),
      )
      .mockReturnValueOnce(p.promise);
    const { container } = mount();
    fill(container);
    fireEvent.submit(container.querySelector("form")!);
    const resend = await screen.findByRole("button", {
      name: "Resend verification email",
    });
    fireEvent.click(resend);
    switchLanguage();
    expect(screen.getByRole("button", { name: "Enviando…" })).toBeDisabled();
    await act(async () =>
      outcome === "network"
        ? p.reject(new Error("synthetic network"))
        : p.resolve(reply(outcome === "success", {})),
    );
    expect(
      screen.getByRole("button", {
        name: "Revisa tu correo para encontrar un enlace de verificación.",
      }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Please verify raw account",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: raw.email }),
    });
  },
);
it.each(["fallback", "network", "raw"] as const)(
  "register late %s feedback uses current locale, keeping consent and autofilled payload",
  async (outcome) => {
    const p = deferred();
    (fetch as jest.Mock).mockReturnValue(p.promise);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = mount(true);
      fill(container, true);
      fireEvent.submit(container.querySelector("form")!);
      switchLanguage();
      expect(
        screen.getByRole("button", { name: messages.es.auth.creatingAccount }),
      ).toBeDisabled();
      expect(container.querySelector("#terms")).toBeChecked();
      await act(async () =>
        outcome === "network"
          ? p.reject(new Error("synthetic network"))
          : p.resolve(
              reply(
                false,
                outcome === "raw" ? { error: "Raw refusal {name} 李" } : {},
              ),
            ),
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        outcome === "raw"
          ? "Raw refusal {name} 李"
          : messages.es.auth[
              outcome === "network" ? "unexpectedError" : "registrationFailed"
            ],
      );
      switchLanguage();
      expect(screen.getByRole("alert")).toHaveTextContent(
        outcome === "raw"
          ? "Raw refusal {name} 李"
          : messages.en.auth[
              outcome === "network" ? "unexpectedError" : "registrationFailed"
            ],
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raw),
      });
      expect(container.querySelector("#password")).toHaveValue(raw.password);
      expect(mockPush).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  },
);
it.each([
  ["mismatch", { confirmPassword: "different" }, "passwordMismatch"],
  [
    "short",
    { password: "short", confirmPassword: "short" },
    "passwordTooShort",
  ],
] as const)(
  "updates visible %s validation without requests or draft loss",
  (kind, values, key) => {
    const { container } = mount(true);
    fill(container, true, values);
    fireEvent.submit(container.querySelector("form")!);
    switchLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent(messages.es.auth[key]);
    expect(container.querySelector("#password")).toHaveValue(
      "password" in values ? values.password : raw.password,
    );
    expect(container.querySelector("#terms")).toBeChecked();
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("preserves registration autofill without events, consent, focus and validity across mounted language changes", () => {
  const { container } = mount(true);
  fill(container, true);
  const name = container.querySelector<HTMLInputElement>("#name")!;
  name.focus();
  switchLanguage();
  expect(name).toHaveFocus();
  for (const [key, value] of Object.entries({
    ...raw,
    confirmPassword: raw.password,
  }))
    expect(container.querySelector(`[name="${key}"]`)).toHaveValue(value);
  expect(container.querySelector("#terms")).toBeChecked();
  expect(
    container.querySelector<HTMLFormElement>("form")!.checkValidity(),
  ).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["parent", "teen", "child", "Unknown {role} 李"])(
  "preserves private invitation parameters, raw token and authoritative email for role %s",
  async (role) => {
    window.history.replaceState(
      {},
      "",
      "/register?token=synthetic%2B%20%7Btoken%7D",
    );
    const p = deferred();
    (fetch as jest.Mock)
      .mockReturnValueOnce(p.promise)
      .mockResolvedValueOnce(reply(true, { joinedFamily: true }));
    const { container } = mount(true);
    switchLanguage();
    await act(async () =>
      p.resolve(reply(true, { email: raw.email, familyName: raw.name, role })),
    );
    const labels: Record<string, string> = {
      parent: "adulto",
      teen: "adolescente",
      child: "niño",
    };
    expect(
      screen.getByText(
        `Únete a ${raw.name} con el rol de ${labels[role] ?? role}`,
      ),
    ).toBeInTheDocument();
    expect(container.querySelector("#email")).toHaveAttribute("readonly");
    switchLanguage();
    fill(container, true, { email: "different@example.test" });
    fireEvent.submit(container.querySelector("form")!);
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch as jest.Mock).mock.calls[0]).toEqual([
      "/api/family/invites/preview?token=synthetic%2B%20%7Btoken%7D",
    ]);
    expect(JSON.parse((fetch as jest.Mock).mock.calls[1][1].body)).toEqual({
      ...raw,
      inviteToken: "synthetic+ {token}",
    });
    expect(mockPush).toHaveBeenCalledWith("/dashboard");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  },
);
it.each(["fallback", "network", "raw"] as const)(
  "localizes late invite %s while preserving raw refusals and preview count",
  async (outcome) => {
    window.history.replaceState({}, "", "/register?token=synthetic");
    const p = deferred();
    (fetch as jest.Mock).mockReturnValue(p.promise);
    mount(true);
    switchLanguage();
    await act(async () =>
      outcome === "network"
        ? p.reject(new Error("synthetic network"))
        : p.resolve(
            reply(
              false,
              outcome === "raw" ? { error: "Raw invite refusal 李" } : {},
            ),
          ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      outcome === "raw"
        ? "Raw invite refusal 李"
        : outcome === "network"
          ? "No pudimos cargar la invitación"
          : "Esta invitación no es válida o ha caducado",
    );
    switchLanguage();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  },
);
it.each(["success", "refusal", "network"] as const)(
  "register success and resend %s remain neutral and use mounted current locale",
  async (outcome) => {
    const p = deferred();
    (fetch as jest.Mock)
      .mockResolvedValueOnce(reply(true, {}))
      .mockReturnValueOnce(p.promise);
    const { container } = mount(true);
    fill(container, true);
    fireEvent.submit(container.querySelector("form")!);
    await screen.findByRole("heading", { name: "Check Your Email" });
    switchLanguage();
    expect(
      screen.getByRole("heading", { name: "Revisa tu correo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ir a iniciar sesión" }),
    ).toHaveAttribute("href", "/login");
    fireEvent.click(
      screen.getByRole("button", { name: "Reenviar correo de verificación" }),
    );
    switchLanguage();
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    await act(async () =>
      outcome === "network"
        ? p.reject(new Error("synthetic network"))
        : p.resolve(reply(outcome === "success", {})),
    );
    expect(
      screen.getByRole("button", {
        name: "Check your email for a verification link.",
      }),
    ).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mockPush).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenLastCalledWith("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: raw.email }),
    });
  },
);
