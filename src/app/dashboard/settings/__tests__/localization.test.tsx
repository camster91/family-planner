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
import { I18nProvider, useTranslation } from "@/i18n";
import SettingsClient from "../SettingsClient";
import BetaMetricsSwitch from "@/components/account/BetaMetricsSwitch";
const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: jest.fn() }),
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
type Call = { url: string; init?: RequestInit };
function api(
  patch?: Promise<Response>,
  extras?: (
    url: string,
    init?: RequestInit,
  ) => Response | Promise<Response> | undefined,
) {
  const calls: Call[] = [];
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const extra = extras?.(url, init);
      if (extra) return extra;
      if (url === "/api/users" && init?.method === "PATCH")
        return patch ?? reply(200, { user: { name: "Synthetic {name} 李" } });
      if (url === "/api/users")
        return reply(200, {
          user: {
            name: "Synthetic {name} 李",
            email: "synthetic@example.test",
            role: "parent",
            age: 30,
          },
        });
      return reply(404, {});
    },
  ) as typeof fetch;
  return calls;
}
function mounted(role: "parent" | "teen" = "parent", ai = false) {
  return render(
    <I18nProvider locale="en" persistLocale>
      <SettingsClient
        viewerRole={role}
        sharedDevice={null}
        aiCaptureSettings={ai}
      />
    </I18nProvider>,
  );
}
async function spanish() {
  await userEvent.selectOptions(
    screen.getByLabelText("Preferred language"),
    "es",
  );
}
beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    ((() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })) as any);
});
beforeEach(() => {
  refresh.mockReset();
  window.localStorage.clear();
  document.documentElement.lang = "en";
});
it("actual language selector keeps an unsaved profile and request count, and late/already-visible success follows current locale", async () => {
  const pending = deferred<Response>();
  const calls = api(pending.promise);
  mounted("teen");
  const name = await screen.findByLabelText("Full Name");
  await waitFor(() => expect(name).toHaveValue("Synthetic {name} 李"));
  fireEvent.change(name, { target: { value: "Private {name} 李" } });
  await userEvent.click(screen.getByRole("button", { name: "Save Profile" }));
  const before = calls.length;
  await spanish();
  expect(screen.getByRole("heading", { name: "Configuración" })).toBeVisible();
  expect(screen.getByLabelText("Nombre completo")).toBe(name);
  expect(name).toHaveValue("Private {name} 李");
  expect(screen.getByRole("button", { name: "Guardando..." })).toBeDisabled();
  expect(calls).toHaveLength(before);
  expect(calls.filter((x) => x.init?.method === "PATCH")).toEqual([
    {
      url: "/api/users",
      init: {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Private {name} 李", age: 30 }),
      },
    },
  ]);
  await act(async () =>
    pending.resolve(reply(200, { user: { name: "Private {name} 李" } })),
  );
  expect(await screen.findByText("¡Perfil actualizado!")).toBeVisible();
  expect(refresh).toHaveBeenCalledTimes(1);
  await userEvent.selectOptions(
    screen.getByLabelText("Idioma preferido"),
    "en",
  );
  expect(screen.getByText("Profile updated successfully!")).toBeVisible();
  expect(calls).toHaveLength(before);
});
it("native password drafts and local mismatch notice survive locale change with no POST or modal remount", async () => {
  const calls = api();
  mounted("teen");
  await screen.findByLabelText("Full Name");
  await userEvent.click(
    screen.getByRole("button", { name: "Change Password" }),
  );
  const dialog = screen.getByRole("dialog");
  const password = within(dialog).getByLabelText("Current Password");
  fireEvent.change(password, { target: { value: "synthetic-old-{name}" } });
  fireEvent.change(within(dialog).getByLabelText("New Password"), {
    target: { value: "synthetic-new-{name}" },
  });
  fireEvent.change(within(dialog).getByLabelText("Confirm New Password"), {
    target: { value: "synthetic-other-{name}" },
  });
  fireEvent.submit(dialog.querySelector("form")!);
  expect(screen.getByText("New passwords do not match")).toBeVisible();
  const before = calls.length;
  fireEvent.change(screen.getByLabelText("Preferred language"), {
    target: { value: "es" },
  });
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(within(dialog).getByLabelText("Contraseña actual")).toBe(password);
  expect(password).toHaveValue("synthetic-old-{name}");
  expect(screen.getByText("Las contraseñas nuevas no coinciden")).toBeVisible();
  expect(calls).toHaveLength(before);
  expect(calls.some((x) => x.init?.method === "POST")).toBe(false);
});
it("late raw profile refusals stay literal across locale changes and do not refresh or replay", async () => {
  const pending = deferred<Response>();
  const calls = api(pending.promise);
  mounted("teen");
  await screen.findByLabelText("Full Name");
  await userEvent.click(screen.getByRole("button", { name: "Save Profile" }));
  await spanish();
  const before = calls.length;
  await act(async () =>
    pending.resolve(reply(400, { error: "Raw {name} <b>李</b>" })),
  );
  expect(await screen.findByText("Raw {name} <b>李</b>")).toBeVisible();
  await userEvent.selectOptions(
    screen.getByLabelText("Idioma preferido"),
    "en",
  );
  expect(screen.getByText("Raw {name} <b>李</b>")).toBeVisible();
  expect(document.querySelector("b")).toBeNull();
  expect(calls).toHaveLength(before);
  expect(refresh).not.toHaveBeenCalled();
});
function Switch() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>switch locale</button>;
}
it("beta pending/authoritative state and late notice change presentation without a second PATCH", async () => {
  const pending = deferred<Response>();
  const calls = api(undefined, (url) =>
    url === "/api/family/beta-metrics" ? pending.promise : undefined,
  );
  render(
    <I18nProvider locale="en">
      <Switch />
      <BetaMetricsSwitch initialEnabled={false} />
    </I18nProvider>,
  );
  const toggle = screen.getByRole("switch", {
    name: "Share beta usage counts",
  });
  await userEvent.click(toggle);
  await userEvent.click(screen.getByRole("button", { name: "switch locale" }));
  expect(
    screen.getByRole("switch", {
      name: "Compartir recuentos de uso de la beta",
    }),
  ).toBe(toggle);
  expect(toggle).toBeDisabled();
  expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(calls).toEqual([
    {
      url: "/api/family/beta-metrics",
      init: {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: '{"enabled":true}',
      },
    },
  ]);
  await act(async () =>
    pending.resolve(reply(200, { betaMetrics: { enabled: true } })),
  );
  expect(
    await screen.findByText("Recuentos de uso de la beta: activados."),
  ).toBeVisible();
  expect(toggle).toBeEnabled();
  expect(calls).toHaveLength(1);
});
it("parent PIN native drafts, focus and local validation survive mounted language change without any credential request", async () => {
  const calls = api();
  render(
    <I18nProvider locale="en">
      <SettingsClient viewerRole="parent" sharedDevice={{ hasPin: false }} />
    </I18nProvider>,
  );
  await screen.findByLabelText("Full Name");
  await userEvent.click(screen.getByRole("button", { name: "Set PIN" }));
  const dialog = screen.getByRole("dialog");
  const pin = within(dialog).getByLabelText("New 6-digit PIN");
  await waitFor(() => expect(pin).toHaveFocus());
  fireEvent.change(pin, { target: { value: "248" } });
  const before = calls.length;
  fireEvent.submit(dialog.querySelector("form")!);
  expect(screen.getByText("The PIN must be exactly 6 digits.")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Preferred language"), {
    target: { value: "es" },
  });
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(within(dialog).getByLabelText("PIN nuevo de 6 dígitos")).toBe(pin);
  expect(pin).toHaveValue("248");
  expect(pin).toHaveFocus();
  expect(
    screen.getByText("El PIN debe tener exactamente 6 dígitos."),
  ).toBeVisible();
  expect(calls).toHaveLength(before);
  expect(calls.some((x) => x.url === "/api/users/elevation-pin")).toBe(false);
});
it("subscription rename draft and late refresh counts follow locale with private name/URL hint unchanged and no replay", async () => {
  const pending = deferred<Response>();
  const sub = {
    id: "synthetic-sub",
    name: "School {name} 李",
    color: "#2563eb",
    url_hint: "synthetic.example.test",
    last_fetched_at: null,
    last_status: "never",
    last_error: null,
  };
  const calls = api(undefined, (url, init) => {
    if (url === "/api/calendar/subscriptions")
      return reply(200, { subscriptions: [sub] });
    if (url.endsWith("/synthetic-sub/refresh")) return pending.promise;
    return undefined;
  });
  mounted();
  await screen.findByLabelText("Full Name");
  await userEvent.click(
    (
      await screen.findByRole("heading", { name: "Subscribed calendars" })
    ).closest("summary")!,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Rename School {name} 李" }),
  );
  const draft = screen.getByLabelText("New name");
  fireEvent.change(draft, { target: { value: "Private {name} 李" } });
  const draftReads = calls.length;
  await spanish();
  expect(screen.getByLabelText("Nombre nuevo")).toBe(draft);
  expect(draft).toHaveValue("Private {name} 李");
  expect(calls).toHaveLength(draftReads);
  await userEvent.selectOptions(
    screen.getByLabelText("Idioma preferido"),
    "en",
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh School {name} 李" }),
  );
  const before = calls.length;
  await spanish();
  expect(screen.getByText("synthetic.example.test")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Actualizar School {name} 李" }),
  ).toBeDisabled();
  expect(calls).toHaveLength(before);
  await act(async () =>
    pending.resolve(
      reply(200, {
        subscription: sub,
        result: { status: "ok", created: 2, updated: 3, deleted: 1 },
      }),
    ),
  );
  expect(
    await screen.findByText(
      "Actualizado: 2 nuevos, 3 cambiados, 1 eliminados.",
    ),
  ).toBeVisible();
  await userEvent.selectOptions(
    screen.getByLabelText("Idioma preferido"),
    "en",
  );
  expect(
    screen.getByText("Refreshed: 2 new, 3 changed, 1 removed."),
  ).toBeVisible();
  expect(calls.filter((x) => x.init?.method === "POST")).toEqual([
    {
      url: "/api/calendar/subscriptions/synthetic-sub/refresh",
      init: { method: "POST" },
    },
  ]);
  expect(calls).toHaveLength(before);
});
it("connected calendar picker and late sync count preserve exact private provider/calendar values and canonical requests on locale change", async () => {
  const pending = deferred<Response>();
  const c = {
    id: "synthetic-conn",
    provider: "google",
    provider_label: "Google {provider} 李",
    calendar_id: "private-id",
    calendar_name: "Calendar {name} 李",
    push_mode: "linked",
    status: "ok",
    last_synced_at: null,
    last_error: null,
    conflicts_count: 1,
    owner: { id: "synthetic-owner", name: "Owner {name} 李" },
    is_mine: true,
  };
  const calls = api(undefined, (url, init) => {
    if (url === "/api/calendar/connections")
      return reply(200, {
        providers: [{ id: "google", label: c.provider_label }],
        connections: [c],
      });
    if (url.endsWith("/synthetic-conn/calendars"))
      return reply(200, {
        calendars: [
          { id: "private-id", name: "Calendar {name} 李", primary: true },
          { id: "draft-id", name: "Draft {name} 李", primary: false },
        ],
      });
    if (url.endsWith("/synthetic-conn/sync")) return pending.promise;
    return undefined;
  });
  render(
    <I18nProvider locale="en">
      <SettingsClient viewerRole="parent" sharedDevice={null} calendarSync />
    </I18nProvider>,
  );
  await screen.findByLabelText("Full Name");
  await userEvent.click(
    (
      await screen.findByRole("heading", { name: "Connected calendars" })
    ).closest("summary")!,
  );
  await userEvent.click(
    screen.getByRole("button", {
      name: "Change calendar for Google {provider} 李",
    }),
  );
  const select = await screen.findByLabelText("Calendar to sync");
  await userEvent.selectOptions(select, "draft-id");
  const before = calls.length;
  await spanish();
  expect(screen.getByLabelText("Calendario que se sincronizará")).toBe(select);
  expect(select).toHaveValue("draft-id");
  expect(
    screen.getByRole("option", { name: "Calendar {name} 李 (principal)" }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "1 conflicto de edición resuelto (se conservó el último cambio).",
    ),
  ).toBeVisible();
  expect(calls).toHaveLength(before);
  await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  await userEvent.click(
    screen.getByRole("button", {
      name: "Sincronizar Google {provider} 李 ahora",
    }),
  );
  const inFlight = calls.length;
  await userEvent.selectOptions(
    screen.getByLabelText("Idioma preferido"),
    "en",
  );
  expect(
    screen.getByRole("button", { name: "Sync Google {provider} 李 now" }),
  ).toBeDisabled();
  expect(calls).toHaveLength(inFlight);
  await act(async () =>
    pending.resolve(
      reply(200, {
        connection: c,
        result: {
          status: "ok",
          pulled: { created: 2, updated: 1, deleted: 0 },
          pushed: { created: 0, updated: 1, deleted: 0 },
        },
      }),
    ),
  );
  expect(await screen.findByText("Synced: 3 changes in, 1 out.")).toBeVisible();
  await spanish();
  expect(
    screen.getByText("Sincronizado: 3 cambios entrantes, 1 salientes."),
  ).toBeVisible();
  expect(calls.filter((x) => x.init?.method === "POST")).toEqual([
    {
      url: "/api/calendar/sync-connections/synthetic-conn/sync",
      init: { method: "POST" },
    },
  ]);
  expect(calls).toHaveLength(inFlight);
});
it("known provider-return feedback follows mounted locale once, while the query cleanup and load/picker never replay", async () => {
  const calls = api(undefined, (url) =>
    url === "/api/calendar/connections"
      ? reply(200, { providers: [], connections: [] })
      : undefined,
  );
  window.history.replaceState(
    null,
    "",
    "/dashboard/settings?calendar_sync=scope&keep=synthetic",
  );
  try {
    render(
      <I18nProvider locale="en">
        <SettingsClient viewerRole="parent" sharedDevice={null} calendarSync />
      </I18nProvider>,
    );
    await screen.findByLabelText("Full Name");
    expect(
      await screen.findByText(
        "Nothing was connected because calendar access was not allowed. Try again and tick every box on the permission screen.",
      ),
    ).toBeVisible();
    const before = calls.length;
    await spanish();
    expect(
      screen.getByText(
        "No se conectó nada porque no se permitió el acceso al calendario. Vuelve a intentarlo y marca todas las casillas en la pantalla de permisos.",
      ),
    ).toBeVisible();
    expect(window.location.search).toBe("?keep=synthetic");
    expect(calls).toHaveLength(before);
    expect(
      calls.filter((x) => x.url === "/api/calendar/connections"),
    ).toHaveLength(1);
  } finally {
    window.history.replaceState(null, "", "/");
  }
});
it("delayed first profile load mounts household sections exactly once and does not discard the one-shot provider result", async () => {
  const pending = deferred<Response>();
  const calls = api(undefined, (url) =>
    url === "/api/users"
      ? pending.promise
      : url === "/api/calendar/connections"
        ? reply(200, { providers: [], connections: [] })
        : undefined,
  );
  window.history.replaceState(
    null,
    "",
    "/dashboard/settings?calendar_sync=denied",
  );
  const view = render(
    <I18nProvider locale="es">
      <SettingsClient viewerRole="parent" sharedDevice={null} calendarSync />
    </I18nProvider>,
  );
  try {
    expect(screen.getByText("Cargando configuración...")).toBeVisible();
    expect(
      calls.some(
        (x) =>
          x.url === "/api/calendar/connections" ||
          x.url === "/api/calendar/subscriptions",
      ),
    ).toBe(false);
    expect(window.location.search).toBe("?calendar_sync=denied");
    await act(async () =>
      pending.resolve(
        reply(200, {
          user: {
            name: "Synthetic {name} 李",
            email: "synthetic@example.test",
            role: "parent",
            age: null,
          },
        }),
      ),
    );
    expect(
      await screen.findByText("Conexión cancelada. No se conectó nada."),
    ).toBeVisible();
    expect(
      calls.filter((x) => x.url === "/api/calendar/connections"),
    ).toHaveLength(1);
    expect(
      calls.filter((x) => x.url === "/api/calendar/subscriptions"),
    ).toHaveLength(1);
    expect(window.location.search).toBe("");
  } finally {
    view.unmount();
    window.history.replaceState(null, "", "/");
  }
});
it("AI pending key/model drafts and late saved notice survive language changes without replay or a reset of the 2.5s lifetime", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const pending = deferred<Response>();
  const calls = api(undefined, (url, init) =>
    url === "/api/family/ai-settings"
      ? init?.method === "POST"
        ? pending.promise
        : reply(200, {
            configured: true,
            keyHint: "masked {hint} 李",
            baseUrl: "https://synthetic.example.test",
            model: "model {name} 李",
          })
      : undefined,
  );
  const view = mounted("parent", true);
  try {
    await screen.findByLabelText("Full Name");
    await user.click(
      screen.getByRole("heading", { name: "AI capture" }).closest("summary")!,
    );
    const key = screen.getByLabelText("API key");
    expect(key).toHaveValue("");
    expect(key).toHaveAttribute("placeholder", "Saved: masked {hint} 李");
    fireEvent.change(key, { target: { value: "synthetic-fixture-input" } });
    const model = screen.getByLabelText(/Model/);
    fireEvent.change(model, { target: { value: "private-model-{name}-李" } });
    const aiSection = key.closest("details")!;
    await user.click(within(aiSection).getByRole("button", { name: "Save" }));
    const before = calls.length;
    await user.selectOptions(screen.getByLabelText("Preferred language"), "es");
    expect(key).toHaveValue("synthetic-fixture-input");
    expect(screen.getByLabelText(/Modelo/)).toBe(model);
    expect(model).toHaveValue("private-model-{name}-李");
    expect(
      within(aiSection).getByRole("button", { name: "Guardando…" }),
    ).toBeDisabled();
    expect(aiSection).toHaveAttribute("open");
    expect(calls).toHaveLength(before);
    await act(async () =>
      pending.resolve(
        reply(200, { configured: true, keyHint: "masked {hint} 李" }),
      ),
    );
    expect(screen.getByText("Guardado")).toBeVisible();
    expect(key).toHaveValue("");
    expect(key).toHaveAttribute("placeholder", "Guardada: masked {hint} 李");
    act(() => jest.advanceTimersByTime(1000));
    await user.selectOptions(screen.getByLabelText("Idioma preferido"), "en");
    expect(screen.getByText("Saved")).toBeVisible();
    act(() => jest.advanceTimersByTime(1499));
    expect(screen.getByText("Saved")).toBeVisible();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByText("Saved")).toBeNull();
    expect(
      calls.filter(
        (x) => x.url === "/api/family/ai-settings" && x.init?.method === "POST",
      ),
    ).toEqual([
      {
        url: "/api/family/ai-settings",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: "synthetic-fixture-input",
            baseUrl: "https://synthetic.example.test",
            model: "private-model-{name}-李",
          }),
        },
      },
    ]);
    expect(calls).toHaveLength(before);
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});
it("feed clipboard uses the literal private link and its original 2s copied notice without locale-triggered token regeneration", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const writeText = jest.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const calls = api(undefined, (url) =>
    url === "/api/family/feed-token"
      ? reply(200, { feedToken: "synthetic-fixture-feed-token" })
      : undefined,
  );
  const view = mounted();
  try {
    await screen.findByLabelText("Full Name");
    await user.click(
      screen
        .getByRole("heading", { name: "Calendar feed" })
        .closest("summary")!,
    );
    const link = screen.getByLabelText("Your private link");
    const url =
      "http://localhost/api/calendar/feed?token=synthetic-fixture-feed-token";
    expect(link).toHaveValue(url);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(url);
    const before = calls.length;
    act(() => jest.advanceTimersByTime(700));
    await user.selectOptions(screen.getByLabelText("Preferred language"), "es");
    expect(screen.getByLabelText("Tu enlace privado")).toBe(link);
    expect(link).toHaveValue(url);
    expect(screen.getByRole("button", { name: "Copiado" })).toBeVisible();
    act(() => jest.advanceTimersByTime(1299));
    expect(screen.getByRole("button", { name: "Copiado" })).toBeVisible();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByRole("button", { name: "Copiar enlace" })).toBeVisible();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(before);
    expect(calls.some((x) => x.init?.method === "POST")).toBe(false);
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});
it("native password success uses current language but closes after the original 2s and posts exact synthetic form values once", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const pending = deferred<Response>();
  const calls = api(undefined, (url, init) =>
    url === "/api/auth/change-password" && init?.method === "POST"
      ? pending.promise
      : undefined,
  );
  const view = mounted("teen");
  try {
    await screen.findByLabelText("Full Name");
    await user.click(screen.getByRole("button", { name: "Change Password" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Current Password"), {
      target: { value: "synthetic-fixture-old" },
    });
    fireEvent.change(within(dialog).getByLabelText("New Password"), {
      target: { value: "synthetic-fixture-new" },
    });
    fireEvent.change(within(dialog).getByLabelText("Confirm New Password"), {
      target: { value: "synthetic-fixture-new" },
    });
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.change(screen.getByLabelText("Preferred language"), {
      target: { value: "es" },
    });
    await act(async () => pending.resolve(reply(200, {})));
    expect(screen.getByText("Contraseña cambiada")).toBeVisible();
    act(() => jest.advanceTimersByTime(1000));
    fireEvent.change(screen.getByLabelText("Idioma preferido"), {
      target: { value: "en" },
    });
    expect(screen.getByText("Password Changed")).toBeVisible();
    act(() => jest.advanceTimersByTime(999));
    expect(screen.getByRole("dialog")).toBe(dialog);
    act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.filter((x) => x.init?.method === "POST")).toEqual([
      {
        url: "/api/auth/change-password",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword: "synthetic-fixture-old",
            newPassword: "synthetic-fixture-new",
          }),
        },
      },
    ]);
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});
