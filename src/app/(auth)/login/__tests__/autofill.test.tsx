/** @jest-environment jsdom */
import * as React from "react";
import { randomBytes } from "crypto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LoginPage from "../page";
import ResetPasswordPage from "../../reset-password/page";

const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams("token=synthetic-reset"),
}));
jest.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      _params?: unknown,
      scoped?: { en: Record<string, string> },
    ) => scoped?.en[key] ?? key,
  }),
}));
jest.mock("@/lib/offline-queue-browser", () => ({
  clearAllPersonQueues: jest.fn(),
}));

function autofill(container: HTMLElement, values: Record<string, string>) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  for (const [id, value] of Object.entries(values))
    setter.call(container.querySelector(`#${id}`), value);
}

beforeEach(() => {
  push.mockReset();
  window.history.replaceState({}, "", "/login");
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({}) });
});

test("submits saved login credentials without input events and preserves them on reveal", async () => {
  const { container } = render(<LoginPage />);
  const secret = randomBytes(20).toString("base64url");
  autofill(container, { email: "autofill@example.test", password: secret });
  fireEvent.click(screen.getAllByRole("button", { name: "Show password" })[0]);
  expect(container.querySelector<HTMLInputElement>("#password")!.value).toBe(
    secret,
  );
  expect(
    container.querySelector<HTMLFormElement>("form")!.checkValidity(),
  ).toBe(true);
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual(
    { email: "autofill@example.test", password: secret },
  );
});

test("reset accepts a generated password without input events after a mismatch correction", async () => {
  const { container } = render(<ResetPasswordPage />);
  const secret = randomBytes(20).toString("base64url");
  autofill(container, { password: secret, confirmPassword: secret + "x" });
  fireEvent.submit(container.querySelector("form")!);
  await screen.findByText("auth.passwordMismatch");
  expect(global.fetch).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLInputElement>("#password")!.value).toBe(
    secret,
  );
  autofill(container, { confirmPassword: secret });
  fireEvent.click(screen.getAllByRole("button", { name: "Show password" })[0]);
  fireEvent.submit(container.querySelector("form")!);
  await screen.findByText("Your password has been reset successfully.");
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual(
    { token: "synthetic-reset", password: secret },
  );
});
