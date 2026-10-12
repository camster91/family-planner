/** @jest-environment jsdom */

import {
  PENDING_FORM_NAVIGATION_BOOTSTRAP_SCRIPT,
  type PendingFormNavigationBootstrap,
} from "../pending-form-navigation-bootstrap";

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
