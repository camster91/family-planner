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
  PendingFormNavigationPopStateHandler,
} from "@/lib/pending-form-navigation-bootstrap";

let navigateHandler!: PendingFormNavigationNavigateHandler;
let popStateHandler!: PendingFormNavigationPopStateHandler;
let unregisterNavigate: jest.Mock;
let unregisterPopState: jest.Mock;
let registerNavigate: jest.Mock;
let historyBack: jest.SpyInstance;
const originalUrl = "http://localhost/dashboard/pending";

function event(
  cancelable = true,
  navigationType = "traverse",
  sameDocument: boolean | null = true,
): Event & {
  navigationType: string;
  destination?: { sameDocument?: boolean };
} {
  return Object.assign(new Event("navigate", { cancelable }), {
    navigationType,
    ...(sameDocument === null ? {} : { destination: { sameDocument } }),
  });
}

function installBootstrap() {
  unregisterNavigate = jest.fn();
  unregisterPopState = jest.fn();
  registerNavigate = jest.fn(
    (handler: PendingFormNavigationNavigateHandler) => {
      navigateHandler = handler;
      return unregisterNavigate;
    },
  );
  const register = jest.fn((handler: PendingFormNavigationPopStateHandler) => {
    popStateHandler = handler;
    return unregisterPopState;
  });
  const bootstrap: PendingFormNavigationBootstrap = {
    register,
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
  onBack,
  warnOnUnload,
}: {
  busy: boolean;
  onBack?: () => void;
  warnOnUnload?: boolean;
  onNavigation: (navigation: PendingFormNavigation) => void;
}) {
  const navigation = usePendingFormNavigationController(busy, {
    onBack,
    warnOnUnload,
  });
  React.useEffect(() => {
    onNavigation(navigation);
  }, [navigation, onNavigation]);
  return null;
}

beforeEach(() => {
  installBootstrap();
  historyBack = jest.spyOn(window.history, "back").mockImplementation(() => {});
  window.history.replaceState({ route: "base" }, "", originalUrl);
});

afterEach(() => {
  historyBack.mockRestore();
  delete window.__herewovenPendingNavigation;
  window.history.replaceState({ route: "base" }, "", originalUrl);
});

it("cancels a cancelable traverse only while busy and owning the current entry", async () => {
  const view = render(<Harness busy onNavigation={() => {}} />);
  await waitFor(() =>
    expect(window.history.state.__herewovenPendingForm).toEqual(
      expect.any(String),
    ),
  );

  expect(navigateHandler(event())).toBe(true);
  expect(navigateHandler(event(false))).toBe(false);
  expect(navigateHandler(event(true, "push"))).toBe(false);
  expect(navigateHandler(event(true, "traverse", false))).toBe(false);
  expect(navigateHandler(event(true, "traverse", null))).toBe(false);

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

it("suppresses re-arm when authorized release joins an automatic release", async () => {
  let navigation!: PendingFormNavigation;
  const view = render(
    <Harness busy onNavigation={(value) => (navigation = value)} />,
  );
  await waitFor(() =>
    expect(window.history.state.__herewovenPendingForm).toEqual(
      expect.any(String),
    ),
  );

  await act(async () => {
    view.rerender(
      <Harness busy={false} onNavigation={(value) => (navigation = value)} />,
    );
  });
  await act(async () => {
    view.rerender(
      <Harness busy onNavigation={(value) => (navigation = value)} />,
    );
  });
  const release = navigation.releaseBeforeNavigation();
  expect(historyBack).toHaveBeenCalledTimes(1);

  window.history.replaceState({ route: "base" }, "", originalUrl);
  popStateHandler(
    new PopStateEvent("popstate", { state: window.history.state }),
  );
  await expect(release).resolves.toBe(true);
  expect(window.history.state.__herewovenPendingForm).toBeUndefined();
  view.unmount();
});

it("re-arms a retried request after an in-flight release settles", async () => {
  const view = render(<Harness busy onNavigation={() => {}} />);
  await waitFor(() =>
    expect(window.history.state.__herewovenPendingForm).toEqual(
      expect.any(String),
    ),
  );
  const firstToken = window.history.state.__herewovenPendingForm;

  await act(async () => {
    view.rerender(<Harness busy={false} onNavigation={() => {}} />);
  });
  expect(historyBack).toHaveBeenCalledTimes(1);

  // Retry immediately, before the automatic sentinel-consumption pop settles.
  await act(async () => {
    view.rerender(<Harness busy onNavigation={() => {}} />);
  });
  window.history.replaceState({ route: "base" }, "", originalUrl);
  popStateHandler(
    new PopStateEvent("popstate", { state: window.history.state }),
  );

  await waitFor(() => {
    expect(window.history.state.__herewovenPendingForm).toEqual(
      expect.any(String),
    );
    expect(window.history.state.__herewovenPendingForm).not.toBe(firstToken);
  });
  expect(navigateHandler(event())).toBe(true);
  view.unmount();
});

it("does not re-arm after cleanup cancels an in-flight release", async () => {
  const view = render(<Harness busy onNavigation={() => {}} />);
  await waitFor(() =>
    expect(window.history.state.__herewovenPendingForm).toEqual(
      expect.any(String),
    ),
  );
  const token = window.history.state.__herewovenPendingForm;

  await act(async () => {
    view.rerender(<Harness busy={false} onNavigation={() => {}} />);
  });
  view.unmount();
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });

  expect(unregisterNavigate).toHaveBeenCalledTimes(1);
  expect(window.history.state.__herewovenPendingForm).toBe(token);
});

it("unregisters the Navigation API handler during cleanup", () => {
  const view = render(<Harness busy={false} onNavigation={() => {}} />);
  view.unmount();

  expect(registerNavigate).toHaveBeenCalledTimes(1);
  expect(unregisterNavigate).toHaveBeenCalledTimes(1);
  expect(unregisterPopState).toHaveBeenCalledTimes(1);
});

it("lets a clean owned sheet handle Back without warning on unload", () => {
  const close = jest.fn();
  render(
    <Harness
      busy
      onBack={close}
      warnOnUnload={false}
      onNavigation={() => {}}
    />,
  );
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
  expect(navigateHandler(event())).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
  expect(navigateHandler(event(true, "push"))).toBe(false);
  expect(close).toHaveBeenCalledTimes(1);
});

it("requests sheet close only on the initial owned fallback Back, not its restoration", () => {
  const close = jest.fn();
  const forward = jest
    .spyOn(window.history, "forward")
    .mockImplementation(() => {});
  try {
    render(<Harness busy onBack={close} onNavigation={() => {}} />);
    const sentinel = window.history.state;
    window.history.replaceState({ route: "base" }, "", originalUrl);
    expect(
      popStateHandler(
        new PopStateEvent("popstate", { state: window.history.state }),
      ),
    ).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    window.history.replaceState(sentinel, "", originalUrl);
    expect(
      popStateHandler(new PopStateEvent("popstate", { state: sentinel })),
    ).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
  } finally {
    forward.mockRestore();
  }
});

it("retains an explicit dirty-work unload warning when sheet authority is held", () => {
  render(<Harness busy={false} warnOnUnload onNavigation={() => {}} />);
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  expect(navigateHandler(event())).toBe(false);
});
