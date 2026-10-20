"use client";

import * as React from "react";

/** Keep dashboard links from unmounting a routine editor before its owned
 * draft is durable and its same-URL Back sentinel has been consumed. */
export function useRoutineLinkNavigation(
  active: boolean,
  navigate: (href: string) => Promise<void>,
) {
  const latest = React.useRef({ active, navigate });
  latest.current = { active, navigate };
  React.useEffect(() => {
    let pending = false;
    const click = (event: MouseEvent) => {
      if (
        !latest.current.active ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self")
      )
        return;
      const url = new URL(anchor.href, window.location.href);
      if (
        url.origin !== window.location.origin ||
        !(
          url.pathname === "/dashboard" ||
          url.pathname.startsWith("/dashboard/")
        )
      )
        return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pending) return;
      pending = true;
      // The manager owns authority, storage errors, and the final router push.
      // Never fall through to a destination after a failed preparation.
      void latest.current
        .navigate(url.pathname + url.search + url.hash)
        .catch(() => undefined)
        .finally(() => {
          pending = false;
        });
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, []);
}
