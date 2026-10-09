/** @jest-environment jsdom */
import * as React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import DashboardNav from "../DashboardNav";
import { TabBar } from "@/components/ui/tab-bar";
import { OfflineBanner, BACK_ONLINE_MS } from "@/components/ui/offline-banner";
import { I18nProvider, useTranslation } from "@/i18n";
import { defaultFeatures, type FamilyFeatures } from "@/lib/features";
import type { NavUser } from "@/types";
let mockFeatures: FamilyFeatures = defaultFeatures();
const mockPush = jest.fn(),
  mockRefresh = jest.fn(),
  mockClearQueues = jest.fn();
jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/calendar",
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));
jest.mock("@/components/providers/features-provider", () => ({
  useFeatures: () => ({ features: mockFeatures }),
}));
jest.mock("@/lib/offline-queue-browser", () => ({
  clearAllPersonQueues: () => mockClearQueues(),
}));
jest.mock("@/components/account/LazyNotificationPreferences", () => ({
  __esModule: true,
  default: () => <p>Private preference fixture</p>,
}));
jest.mock("@/components/account/LazyDeleteAccountDialog", () => ({
  __esModule: true,
  default: () => null,
}));
let changeLocale: (locale: "en" | "es") => void;
function Control() {
  const { setLocale } = useTranslation();
  changeLocale = setLocale;
  return null;
}
function localized(node: React.ReactNode, locale: "en" | "es" = "es") {
  return render(
    <I18nProvider locale={locale}>
      <Control />
      {node}
    </I18nProvider>,
  );
}
const person = (role: NavUser["role"]): NavUser => ({
  id: "fixture-user",
  name: "Synthetic {name} — 李",
  role,
  avatar_url: null,
});
let online = true;
const onlineSpy = jest.spyOn(window.navigator, "onLine", "get");
function network(state: boolean) {
  online = state;
  act(() => window.dispatchEvent(new Event(state ? "online" : "offline")));
}
beforeEach(() => {
  mockFeatures = defaultFeatures();
  mockPush.mockClear();
  mockRefresh.mockClear();
  mockClearQueues.mockClear();
  online = true;
  onlineSpy.mockImplementation(() => online);
  global.fetch = jest.fn();
});
afterEach(() => {
  jest.useRealTimers();
});
it("updates open parent menu and both tab bars without changing private identity, routes, focus or network", () => {
  localized(
    <>
      <DashboardNav user={person("parent")} />
      <TabBar user={person("parent")} />
    </>,
    "en",
  );
  const opener = screen.getByRole("button", { name: "User menu" });
  opener.focus();
  fireEvent.click(opener);
  const oldLinks = screen
    .getAllByRole("link")
    .map((a) => a.getAttribute("href"));
  act(() => changeLocale("es"));
  expect(screen.getByRole("button", { name: "Menú de usuario" })).toBe(opener);
  expect(opener).toHaveFocus();
  expect(opener).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Synthetic {name} — 李")).toBeVisible();
  expect(screen.getByText("Madre o padre")).toBeVisible();
  expect(
    screen.getAllByRole("link").map((a) => a.getAttribute("href")),
  ).toEqual(oldLinks);
  for (const region of [
    screen.getByTestId("top-tabs"),
    screen.getByRole("navigation", { name: "Pestañas" }),
  ]) {
    expect(
      within(region)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Hoy", "Calendario", "Comidas", "Listas", "Familia"]);
    expect(
      within(region).getByRole("link", { name: "Calendario" }),
    ).toHaveAttribute("aria-current", "page");
  }
  expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockClearQueues).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(opener).toHaveAttribute("aria-expanded", "false");
  expect(opener).toHaveFocus();
});
it("preserves child feature restrictions and an open notification shell through language changes", () => {
  mockFeatures = { ...defaultFeatures(), messages: false, inventory: false };
  localized(
    <>
      <DashboardNav user={person("child")} />
      <TabBar user={person("child")} />
    </>,
    "en",
  );
  fireEvent.click(screen.getByRole("button", { name: "User menu" }));
  fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
  const originalDialogFocus = document.activeElement;
  act(() => changeLocale("es"));
  expect(document.activeElement).toBe(originalDialogFocus);
  const dialog = screen.getByRole("dialog", { name: "Notificaciones" });
  expect(within(dialog).getByText("Private preference fixture")).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Cerrar" })).toBeVisible();
  expect(
    screen.getByRole("navigation", { name: "Pestañas" }),
  ).toHaveTextContent("HoyListasEmergencia");
  expect(screen.queryByRole("link", { name: "Comidas" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Familia" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Ajustes" })).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});
it("localizes offline and recovery copy without restarting the existing recovery deadline", () => {
  jest.useFakeTimers();
  localized(<OfflineBanner />, "en");
  network(false);
  const banner = screen.getByTestId("app-offline-banner");
  act(() => changeLocale("es"));
  expect(banner).toHaveTextContent(
    "Sin conexión. Algunas funciones podrían no cargar ni guardar hasta que vuelva la conexión.",
  );
  network(true);
  act(() => jest.advanceTimersByTime(2000));
  act(() => changeLocale("en"));
  expect(screen.getByTestId("app-offline-banner")).toHaveTextContent(
    "Back online.",
  );
  act(() => jest.advanceTimersByTime(BACK_ONLINE_MS - 2000 - 1));
  expect(screen.getByTestId("app-offline-banner")).toBeVisible();
  act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByTestId("app-offline-banner")).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});
it("keeps offline state after a second disconnect during translated recovery", () => {
  jest.useFakeTimers();
  localized(<OfflineBanner />);
  network(false);
  network(true);
  act(() => changeLocale("en"));
  network(false);
  act(() => changeLocale("es"));
  act(() => jest.advanceTimersByTime(BACK_ONLINE_MS * 2));
  expect(screen.getByTestId("app-offline-banner")).toHaveAttribute(
    "data-state",
    "offline",
  );
  expect(screen.getByTestId("app-offline-banner")).toHaveTextContent(
    "Sin conexión.",
  );
});

it("keeps an in-flight sign-out single across a mounted locale switch", async () => {
  let finish!: () => void;
  mockClearQueues.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
  localized(<DashboardNav user={person("parent")} />, "en");
  fireEvent.click(screen.getByRole("button", { name: "User menu" }));
  fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
  act(() => changeLocale("es"));
  expect(mockClearQueues).toHaveBeenCalledTimes(1);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await Promise.resolve();
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith("/api/auth/logout", {
    method: "POST",
  });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith("/login");
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});
it("keeps a teen restricted to its canonical feature-gated tabs in Spanish", () => {
  mockFeatures = { ...defaultFeatures(), meals: false };
  localized(
    <>
      <DashboardNav user={person("teen")} />
      <TabBar user={person("teen")} />
    </>,
  );
  for (const region of [
    screen.getByTestId("top-tabs"),
    screen.getByRole("navigation", { name: "Pestañas" }),
  ])
    expect(
      within(region)
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual([
      ["Hoy", "/dashboard"],
      ["Calendario", "/dashboard/calendar"],
      ["Listas", "/dashboard/lists"],
      ["Emergencia", "/dashboard/emergency"],
    ]);
  fireEvent.click(screen.getByRole("button", { name: "Menú de usuario" }));
  expect(screen.getByText("Adolescente")).toBeVisible();
  expect(screen.getByRole("link", { name: "Ajustes" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "Familia" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Eliminar mi cuenta" }),
  ).toBeNull();
});
