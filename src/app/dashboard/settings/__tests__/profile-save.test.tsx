/**
 * @jest-environment jsdom
 */
// Saving the profile refreshes the server-rendered layout, so the nav's name
// and initials show the new name without a reload. A failed save does not.
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsClient from "../SettingsClient";
import { I18nProvider } from "@/i18n";

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

const validProfile = {
  user: { name: "Pat", email: "pat@example.test", role: "parent", age: 42 },
};

function mockApi(
  patch: { status: number; body: unknown },
  profile: { status: number; body: unknown } = {
    status: 200,
    body: validProfile,
  },
) {
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const reply = (status: number, body: unknown) =>
        ({ ok: status < 300, status, json: async () => body }) as Response;
      if (url === "/api/users" && method === "PATCH")
        return reply(patch.status, patch.body);
      if (url === "/api/users") {
        return reply(profile.status, profile.body);
      }
      return reply(404, {});
    },
  ) as unknown as typeof fetch;
}

function renderSettings() {
  return render(
    <I18nProvider locale="en">
      <SettingsClient viewerRole="parent" sharedDevice={null} />
    </I18nProvider>,
  );
}

beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    ((() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia);
});

beforeEach(() => refresh.mockReset());

describe("Settings profile save", () => {
  it("refreshes the layout after a successful save", async () => {
    const user = userEvent.setup();
    mockApi({ status: 200, body: { user: { name: "Pat Rivera" } } });
    renderSettings();
    const name = await screen.findByLabelText("Full Name");
    await waitFor(() => expect((name as HTMLInputElement).value).toBe("Pat"));
    await user.clear(name);
    await user.type(name, "Pat Rivera");
    await user.click(screen.getByRole("button", { name: "Save Profile" }));
    expect(
      await screen.findByText("Profile updated successfully!"),
    ).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when the save is refused", async () => {
    const user = userEvent.setup();
    mockApi({ status: 400, body: { error: "Name is required" } });
    renderSettings();
    const name = await screen.findByLabelText("Full Name");
    const age = screen.getByLabelText("Age (optional)");
    await user.clear(name);
    await user.type(name, "Pat Deliberate");
    await user.clear(age);
    await user.type(age, "37");
    await user.click(screen.getByRole("button", { name: "Save Profile" }));
    expect(await screen.findByText("Name is required")).toBeTruthy();
    expect(name).toHaveValue("Pat Deliberate");
    expect(age).toHaveValue(37);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the profile locked after a failed load and retries before allowing a save", async () => {
    const user = userEvent.setup();
    let profileReads = 0;
    let patchCalls = 0;
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        const reply = (status: number, body: unknown) =>
          ({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
          }) as Response;
        if (url === "/api/users" && method === "PATCH") {
          patchCalls += 1;
          return reply(200, { user: { name: "Pat Rivera" } });
        }
        if (url === "/api/users") {
          profileReads += 1;
          if (profileReads === 1) return reply(503, { error: "Unavailable" });
          return reply(200, validProfile);
        }
        return reply(404, {});
      },
    ) as unknown as typeof fetch;

    renderSettings();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load your profile. Retry before making changes.",
    );
    const save = screen.getByRole("button", { name: "Save Profile" });
    expect(save).toBeDisabled();
    expect(screen.getByLabelText("Full Name")).toBeDisabled();
    await user.click(save);
    expect(patchCalls).toBe(0);

    await user.click(screen.getByRole("button", { name: "Retry profile" }));
    const name = await screen.findByLabelText("Full Name");
    await waitFor(() => expect(name).toHaveValue("Pat"));
    expect(name).toBeEnabled();
    await user.clear(name);
    await user.type(name, "Pat Rivera");
    await user.click(screen.getByRole("button", { name: "Save Profile" }));
    await screen.findByText("Profile updated successfully!");
    expect(patchCalls).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/users",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Pat Rivera", age: 42 }),
      }),
    );
  });

  it("keeps the profile locked when the profile request fails on the network", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/users")
        throw new TypeError("Network unavailable");
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    renderSettings();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load your profile. Retry before making changes.",
    );
    expect(screen.getByRole("button", { name: "Save Profile" })).toBeDisabled();
  });

  it("rejects a malformed successful profile response without enabling save", async () => {
    mockApi(
      { status: 200, body: { user: { name: "Should not save" } } },
      { status: 200, body: { user: { name: "Pat" } } },
    );

    renderSettings();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load your profile. Retry before making changes.",
    );
    expect(screen.getByRole("button", { name: "Save Profile" })).toBeDisabled();
    expect(screen.getByLabelText("Full Name")).toBeDisabled();
  });
});
