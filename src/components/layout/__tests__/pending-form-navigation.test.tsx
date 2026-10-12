/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { act, render, waitFor } from "@testing-library/react";
import {
  usePendingFormNavigationController,
  type PendingFormNavigation,
} from "../pending-form-navigation";
import type {
  PendingFormNavigationBootstrap,
  PendingFormNavigationNavigateHandler,
} from "@/lib/pending-form-navigation-bootstrap";

let navigateHandler!: PendingFormNavigationNavigateHandler;
let unregisterNavigate: jest.Mock;
let unregisterPopState: jest.Mock;
let registerNavigate: jest.Mock;
let historyBack: jest.SpyInstance;
const originalUrl = "http://localhost/dashboard/pending";

function event(
  cancelable = true,
  navigationType = "traverse",
): Event & { navigationType: string } {
  return Object.assign(new Event("navigate", { cancelable }), {
    navigationType,
  });
}

function installBootstrap() {
  unregisterNavigate = jest.fn();
  unregisterPopState = jest.fn();
  registerNavigate = jest.fn((handler: PendingFormNavigationNavigateHandler) => {
    navigateHandler = handler;
    return unregisterNavigate;
  });
  const bootstrap: PendingFormNavigationBootstrap = {
    register: jest.fn(() => unregisterPopState),
    registerNavigate,
  };
  Object.defineProperty(window, "__herewovenPendingNavigation", {
    configurable: true,
    value: bootstrap,
  });
}

function Harness({
  busy,
  onNavigation,
}: {
  busy: boolean;
  onNavigation: (navigation: PendingFormNavigation) => void;
}) {
  const navigation = usePendingFormNavigationController(busy);
  React.useEffect(() => {
    onNavigation(navigation);
  }, [navigation, onNavigation]);
  return null;
}

beforeEach(() => {
  installBootstrap();
  historyBack = jest
    .spyOn(window.history, "back")
    .mockImplementation(() => {});
  window.history.replaceState({ route: "base" }, "", originalUrl);
});

afterEach(() => {
  historyBack.mockRestore();
  delete window.__herewovenPendingNavigation;
  window.history.replaceState({ route: "base" }, "", originalUrl);
});

it("cancels a cancelable traverse only while busy and owning the current entry", async () => {
  const view = render(
    <Harness busy onNavigation={() => {}} />,
  );
  await waitFor(() =>
    expect(window.history.state.__herewovenPendingForm).toEqual(
      expect.any(String),
    ),
  );

  expect(navigateHandler(event())).toBe(true);
  expect(navigateHandler(event(false))).toBe(false);
  expect(navigateHandler(event(true, "push"))).toBe(false);

  window.history.replaceState({ route: "foreign" }, "", "/dashboard/other");
  expect(navigateHandler(event())).toBe(false);
  view.unmount();
});

it("passes through idle and no-entry controllers", async () => {
  let navigation!: PendingFormNavigation;
  const view = render(
    <Harness busy={false} onNavigation={(value) => (navigation = value)} />,
  );
  await waitFor(() => expect(navigation).toBeDefined());

  expect(navigateHandler(event())).toBe(false);
  expect(navigateHandler(event(false))).toBe(false);
  view.unmount();
});

it("passes through an authorized release while the request is still marked busy", async () => {
  let navigation!: PendingFormNavigation;
  const view = render(
    <Harness busy onNavigation={(value) => (navigation = value)} />,
  );
  await waitFor(() =>
    expect(window.history.state.__herewovenPendingForm).toEqual(
      expect.any(String),
    ),
  );

  let release!: Promise<boolean>;
  act(() => {
    release = navigation.releaseBeforeNavigation();
  });
  expect(historyBack).toHaveBeenCalledTimes(1);
  expect(navigateHandler(event())).toBe(false);
  view.unmount();
  await expect(release).resolves.toBe(false);
});

it("unregisters the Navigation API handler during cleanup", () => {
  const view = render(<Harness busy={false} onNavigation={() => {}} />);
  view.unmount();

  expect(registerNavigate).toHaveBeenCalledTimes(1);
  expect(unregisterNavigate).toHaveBeenCalledTimes(1);
  expect(unregisterPopState).toHaveBeenCalledTimes(1);
});
