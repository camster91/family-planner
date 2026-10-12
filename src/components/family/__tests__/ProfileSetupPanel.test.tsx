/** @jest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import { ProfileSetupPanel } from "../ProfileSetupPanel";

const profile = {
  id: "profile-jamie",
  family_id: "family-1",
  name: "Jamie",
  role: "child",
  age: null,
  archived_at: null,
  revision: 0,
};

function renderPanel(
  locale: "en" | "es" = "en",
  onProfilesChanged?: () => void | Promise<void>,
) {
  return render(
    <I18nProvider locale={locale}>
      <ProfileSetupPanel onProfilesChanged={onProfilesChanged} />
    </I18nProvider>,
  );
}

describe("ProfileSetupPanel", () => {
  afterEach(() => jest.restoreAllMocks());

  it("keeps the unsupported server explanation behind the safe trigger", async () => {
    const user = userEvent.setup();
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: "PROFILE_SETUP_UNSUPPORTED" } }),
    })) as unknown as typeof fetch;
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Add a household profile" }));
    expect(await screen.findByRole("heading", { name: "Profiles are unavailable here" })).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.getByRole("link", { name: "Invite with an account" }).getAttribute("href")).toBe(
      "/dashboard/family/invite",
    );
  });

  it("reuses the idempotency key after a network failure and then displays the safe profile DTO in Spanish", async () => {
    const user = userEvent.setup();
    const calls: Array<{ init?: RequestInit }> = [];
    let saveAttempts = 0;
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ init });
      if (init?.method !== "POST") return { ok: true, status: 200, json: async () => ({ profiles: [] }) };
      saveAttempts += 1;
      if (saveAttempts === 1) throw new Error("offline");
      return { ok: true, status: 201, json: async () => ({ profile }) };
    }) as unknown as typeof fetch;
    renderPanel("es");

    await user.click(screen.getByRole("button", { name: "Añadir un perfil del hogar" }));
    await screen.findByLabelText("Nombre");
    await user.type(screen.getByLabelText("Nombre"), "Jamie");
    await user.click(screen.getByRole("button", { name: "Guardar perfil" }));
    expect(await screen.findByText("Comprueba la conexión e inténtalo de nuevo. Tu entrada sigue aquí.")).toBeTruthy();
    const firstKey = (calls[1].init?.headers as Record<string, string>)["Idempotency-Key"];
    expect(firstKey).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Guardar perfil" }));
    await waitFor(() => expect(screen.getByText("Perfil guardado.")).toBeTruthy());
    const secondKey = (calls[2].init?.headers as Record<string, string>)["Idempotency-Key"];
    expect(secondKey).toBe(firstKey);
    expect(screen.getByText("Jamie")).toBeTruthy();
  });

  it("starts a new command key when the draft changes after an ambiguous failure", async () => {
    const user = userEvent.setup();
    const calls: Array<{ init?: RequestInit }> = [];
    let saveAttempts = 0;
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ init });
      if (init?.method !== "POST") return { ok: true, status: 200, json: async () => ({ profiles: [] }) };
      saveAttempts += 1;
      if (saveAttempts === 1) throw new Error("connection lost after send");
      return { ok: true, status: 201, json: async () => ({ profile: { ...profile, name: "Taylor" } }) };
    }) as unknown as typeof fetch;
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Add a household profile" }));
    await screen.findByLabelText("Name");
    await user.type(screen.getByLabelText("Name"), "Jamie");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText("Check your connection and try again. Your entry is still here.");
    const firstKey = (calls[1].init?.headers as Record<string, string>)["Idempotency-Key"];

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Taylor");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.getByText("Profile saved.")).toBeTruthy());
    const secondKey = (calls[2].init?.headers as Record<string, string>)["Idempotency-Key"];
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
    expect(JSON.parse(String(calls[2].init?.body)).name).toBe("Taylor");
  });

  it("releases the save guard after commit even when roster refresh is still pending", async () => {
    const user = userEvent.setup();
    let resolveRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return { ok: true, status: 200, json: async () => ({ profiles: [] }) };
      }
      return { ok: true, status: 201, json: async () => ({ profile }) };
    }) as unknown as typeof fetch;
    renderPanel("en", () => pendingRefresh);

    await user.click(screen.getByRole("button", { name: "Add a household profile" }));
    await screen.findByLabelText("Name");
    await user.type(screen.getByLabelText("Name"), "Jamie");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByText("Profile saved.")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(false);
    resolveRefresh();
  });
});
