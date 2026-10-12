/** @jest-environment jsdom */

import {
  PENDING_FORM_NAVIGATION_BOOTSTRAP_SCRIPT,
  type PendingFormNavigationBootstrap,
} from "../pending-form-navigation-bootstrap";

let originalNavigation: PropertyDescriptor | undefined;

beforeEach(() => {
  originalNavigation = Object.getOwnPropertyDescriptor(window, "navigation");
  delete window.__herewovenPendingNavigation;
});

afterEach(() => {
  delete window.__herewovenPendingNavigation;
  if (originalNavigation) {
    Object.defineProperty(window, "navigation", originalNavigation);
  } else {
    delete (window as Window & { navigation?: unknown }).navigation;
  }
});

it("runs the registered pending handler before a later window listener", () => {
  const runBootstrap = new Function(PENDING_FORM_NAVIGATION_BOOTSTRAP_SCRIPT);
  runBootstrap();

  const bootstrap = window.__herewovenPendingNavigation as
    | PendingFormNavigationBootstrap
    | undefined;
  expect(bootstrap).toBeDefined();

  const pendingHandler = jest.fn(() => true);
  const nextRouterListener = jest.fn();
  const unregister = bootstrap!.register(pendingHandler);
  window.addEventListener("popstate", nextRouterListener);

  window.dispatchEvent(new PopStateEvent("popstate"));

  expect(pendingHandler).toHaveBeenCalledTimes(1);
  expect(nextRouterListener).not.toHaveBeenCalled();

  unregister();
  window.removeEventListener("popstate", nextRouterListener);
});

it("prevents cancelable traverses before later Navigation API listeners", () => {
  const navigation = new EventTarget();
  Object.defineProperty(window, "navigation", {
    configurable: true,
    value: navigation,
  });
  const runBootstrap = new Function(PENDING_FORM_NAVIGATION_BOOTSTRAP_SCRIPT);
  runBootstrap();

  const bootstrap = window.__herewovenPendingNavigation!;
  const pendingHandler = jest.fn(() => true);
  const laterListener = jest.fn();
  bootstrap.registerNavigate!(pendingHandler);
  navigation.addEventListener("navigate", laterListener);

  const event = Object.assign(new Event("navigate", { cancelable: true }), {
    navigationType: "traverse",
    destination: { sameDocument: true },
  });
  navigation.dispatchEvent(event);

  expect(pendingHandler).toHaveBeenCalledTimes(1);
  expect(event.defaultPrevented).toBe(true);
  expect(laterListener).not.toHaveBeenCalled();
});

it("passes through non-traverses and noncancelable traverses", () => {
  const navigation = new EventTarget();
  Object.defineProperty(window, "navigation", {
    configurable: true,
    value: navigation,
  });
  const runBootstrap = new Function(PENDING_FORM_NAVIGATION_BOOTSTRAP_SCRIPT);
  runBootstrap();

  const bootstrap = window.__herewovenPendingNavigation!;
  const pendingHandler = jest.fn(() => true);
  const laterListener = jest.fn();
  bootstrap.registerNavigate!(pendingHandler);
  navigation.addEventListener("navigate", laterListener);

  const push = Object.assign(new Event("navigate", { cancelable: true }), {
    navigationType: "push",
  });
  const noncancelable = Object.assign(new Event("navigate"), {
    navigationType: "traverse",
    destination: { sameDocument: true },
  });
  navigation.dispatchEvent(push);
  navigation.dispatchEvent(noncancelable);

  expect(pendingHandler).not.toHaveBeenCalled();
  expect(push.defaultPrevented).toBe(false);
  expect(noncancelable.defaultPrevented).toBe(false);
  expect(laterListener).toHaveBeenCalledTimes(2);
});

it("passes through cross-document and unknown destinations", () => {
  const navigation = new EventTarget();
  Object.defineProperty(window, "navigation", {
    configurable: true,
    value: navigation,
  });
  const runBootstrap = new Function(PENDING_FORM_NAVIGATION_BOOTSTRAP_SCRIPT);
  runBootstrap();

  const bootstrap = window.__herewovenPendingNavigation!;
  const pendingHandler = jest.fn(() => true);
  const laterListener = jest.fn();
  bootstrap.registerNavigate!(pendingHandler);
  navigation.addEventListener("navigate", laterListener);

  const crossDocument = Object.assign(
    new Event("navigate", { cancelable: true }),
    {
      navigationType: "traverse",
      destination: { sameDocument: false },
    },
  );
  const unknownDestination = Object.assign(
    new Event("navigate", { cancelable: true }),
    { navigationType: "traverse" },
  );
  navigation.dispatchEvent(crossDocument);
  navigation.dispatchEvent(unknownDestination);

  expect(pendingHandler).not.toHaveBeenCalled();
  expect(crossDocument.defaultPrevented).toBe(false);
  expect(unknownDestination.defaultPrevented).toBe(false);
  expect(laterListener).toHaveBeenCalledTimes(2);
});

it("removes a Navigation API handler when it is unregistered", () => {
  const navigation = new EventTarget();
  Object.defineProperty(window, "navigation", {
    configurable: true,
    value: navigation,
  });
  const runBootstrap = new Function(PENDING_FORM_NAVIGATION_BOOTSTRAP_SCRIPT);
  runBootstrap();

  const bootstrap = window.__herewovenPendingNavigation!;
  const pendingHandler = jest.fn(() => true);
  const unregister = bootstrap.registerNavigate!(pendingHandler);
  unregister();

  const event = Object.assign(new Event("navigate", { cancelable: true }), {
    navigationType: "traverse",
  });
  navigation.dispatchEvent(event);

  expect(pendingHandler).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});
