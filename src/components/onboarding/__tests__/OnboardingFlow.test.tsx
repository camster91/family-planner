/**
 * @jest-environment jsdom
 */
// Onboarding for a signed-in member with no household. A child, teen or second
// parent who registered without their invite link must be able to reach the
// join page from here, not only "Create Family".
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
}));

import OnboardingFlow from "../OnboardingFlow";

describe("OnboardingFlow", () => {
  afterEach(() => jest.restoreAllMocks());
  it("welcomes the family by the product name", () => {
    render(<OnboardingFlow userId="u1" />);
    expect(
      screen.getByRole("heading", { name: "Welcome to Herewoven" }),
    ).toBeTruthy();
  });

  it("offers joining an existing family next to creating one", async () => {
    render(<OnboardingFlow userId="u1" />);
    await userEvent.click(screen.getByRole("button", { name: /get started/i }));
    expect(screen.getByRole("button", { name: /create family/i })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /join an existing family/i })
        .getAttribute("href"),
    ).toBe("/join");
  });
});

describe("family creation next step", () => {
  afterEach(() => jest.restoreAllMocks());

  async function enterFamily() {
    render(<OnboardingFlow userId="u1" />);
    await userEvent.click(screen.getByRole("button", { name: /get started/i }));
    await userEvent.type(
      screen.getByRole("textbox", { name: /family name/i }),
      "Our Family",
    );
  }

  it("prompts adding everyone after the successful canonical creation", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ family: { id: "f1" } }),
    });
    await enterFamily();
    await userEvent.click(
      screen.getByRole("button", { name: /create family/i }),
    );
    expect(
      await screen.findByRole("heading", { name: /add everyone/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /invite an account/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/shared-screen profiles are unavailable/i),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /finish later/i }).getAttribute("href"),
    ).toBe("/dashboard");
    expect(fetch).toHaveBeenCalledWith(
      "/api/family",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Our Family" }),
      }),
    );
  });

  it("retains the draft on server failure and permits retry", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Try again" }),
    });
    await enterFamily();
    await userEvent.click(
      screen.getByRole("button", { name: /create family/i }),
    );
    expect(await screen.findByText("Try again")).toBeTruthy();
    expect(
      (
        screen.getByRole("textbox", {
          name: /family name/i,
        }) as HTMLInputElement
      ).value,
    ).toBe("Our Family");
    expect(screen.queryByRole("heading", { name: /add everyone/i })).toBeNull();
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: /create family/i,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  });

  it("shows the no-login profile choice when the authenticated parent profile surface succeeds", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/family")
        return { ok: true, json: async () => ({ family: { id: "f1" } }) };
      if (url === "/api/family/profiles")
        return { ok: true, json: async () => ({ profiles: [] }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await enterFamily();
    await userEvent.click(
      screen.getByRole("button", { name: /create family/i }),
    );
    expect(
      await screen.findByRole("button", { name: /add a household profile/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/without an email or personal device/i),
    ).toBeTruthy();
  });

  it("sends an account invite from the Add Everyone choice and refreshes the roster", async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        if (url === "/api/family")
          return { ok: true, json: async () => ({ family: { id: "f1" } }) };
        if (url === "/api/capabilities")
          return {
            ok: true,
            json: async () => ({
              contract: "herewoven.capabilities.v1",
              memberProtocols: [1],
              queueContainerVersion: 1,
              queueActions: [],
            }),
          };
        if (url === "/api/family/invites" && init?.method === "POST")
          return {
            ok: true,
            json: async () => ({
              success: true,
              invite: {
                email: "kid@example.com",
                role: "child",
                expires_at: "2026-10-20T00:00:00.000Z",
              },
            }),
          };
        if (url === "/api/family/members")
          return {
            ok: true,
            json: async () => ({ members: [{ id: "parent" }] }),
          };
        return { ok: true, json: async () => ({}) };
      },
    ) as unknown as typeof fetch;

    await enterFamily();
    await userEvent.click(
      screen.getByRole("button", { name: /create family/i }),
    );
    await screen.findByRole("button", { name: /invite an account/i });
    await userEvent.click(
      screen.getByRole("button", { name: /invite an account/i }),
    );
    await userEvent.type(screen.getByLabelText("Email"), "kid@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send invite/i }));

    expect(await screen.findByText(/invite sent/i)).toBeTruthy();
    expect(calls).toContain("/api/family/invites");
    expect(calls).toContain("/api/family/members");
    expect(
      JSON.parse(
        String(
          (global.fetch as jest.Mock).mock.calls.find(
            ([url]) => url === "/api/family/invites",
          )[1].body,
        ),
      ),
    ).toEqual({ email: "kid@example.com", role: "child" });
  });

  it("requires a canonical family id and reconciles a committed server error without a second create", async () => {
    const calls: string[] = [];
    let createAttempts = 0;
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === "/api/family") {
        createAttempts += 1;
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "The response was interrupted" }),
        };
      }
      if (url === "/api/auth/me")
        return { ok: true, json: async () => ({ user: { family_id: "f1" } }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await enterFamily();
    await userEvent.click(screen.getByRole("button", { name: /create family/i }));
    expect(await screen.findByRole("heading", { name: /add everyone/i })).toBeTruthy();
    expect(createAttempts).toBe(1);
    expect(calls.filter((url) => url === "/api/auth/me")).toHaveLength(1);
  });

  it("does not advance on a malformed successful family response", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/family")
        return { ok: true, status: 200, json: async () => ({ family: { name: "Our Family" } }) };
      if (url === "/api/auth/me")
        return { ok: true, status: 200, json: async () => ({ user: { family_id: null } }) };
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await enterFamily();
    await userEvent.click(screen.getByRole("button", { name: /create family/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/unexpected family response/i);
    expect(screen.queryByRole("heading", { name: /add everyone/i })).toBeNull();
    expect(screen.getByRole("textbox", { name: /family name/i })).toBeTruthy();
  });

  it("keeps the invite draft when a 2xx response lacks the confirmed invite envelope", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/family")
        return { ok: true, status: 200, json: async () => ({ family: { id: "f1" } }) };
      if (url === "/api/family/invites" && init?.method === "POST")
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await enterFamily();
    await userEvent.click(screen.getByRole("button", { name: /create family/i }));
    await userEvent.click(await screen.findByRole("button", { name: /invite an account/i }));
    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    await userEvent.type(emailInput, "kid@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send invite/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not send the invite/i);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("kid@example.com");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("reconciles an ambiguous family create without issuing a second create", async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === "/api/family")
        throw new Error("connection lost after commit");
      if (url === "/api/auth/me")
        return { ok: true, json: async () => ({ user: { family_id: "f1" } }) };
      if (url === "/api/capabilities")
        return {
          ok: true,
          json: async () => ({
            contract: "herewoven.capabilities.v1",
            memberProtocols: [1],
            queueContainerVersion: 1,
            queueActions: [],
          }),
        };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await enterFamily();
    await userEvent.click(
      screen.getByRole("button", { name: /create family/i }),
    );
    expect(
      await screen.findByRole("heading", { name: /add everyone/i }),
    ).toBeTruthy();
    expect(calls.filter((url) => url === "/api/family")).toHaveLength(1);
    expect(calls).toContain("/api/auth/me");
    expect(screen.getByText(/family was created/i)).toBeTruthy();
  });

  it("uses the localized Add Everyone copy without changing account/profile meaning", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/family")
        return { ok: true, json: async () => ({ family: { id: "f1" } }) };
      if (String(input) === "/api/capabilities")
        return {
          ok: true,
          json: async () => ({
            contract: "herewoven.capabilities.v1",
            memberProtocols: [1],
            queueContainerVersion: 1,
            queueActions: [],
          }),
        };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;

    render(
      <I18nProvider locale="es">
        <OnboardingFlow userId="u1" />
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /empezar/i }));
    await userEvent.type(
      screen.getByRole("textbox", { name: /nombre de la familia/i }),
      "Nuestra familia",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /crear familia/i }),
    );
    expect(
      await screen.findByRole("heading", {
        name: /añade a todas las personas/i,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /invitar una cuenta/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/sin correo electrónico o dispositivo personal/i),
    ).toBeTruthy();
  });
});
