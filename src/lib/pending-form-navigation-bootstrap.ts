export type PendingFormNavigationPopStateHandler = (
  event: PopStateEvent,
) => boolean;

export type PendingFormNavigationNavigateEvent = Event & {
  navigationType?: string;
  destination?: {
    sameDocument?: boolean;
  };
};

export type PendingFormNavigationNavigateHandler = (
  event: PendingFormNavigationNavigateEvent,
) => boolean;

export type PendingFormNavigationBootstrap = {
  register: (handler: PendingFormNavigationPopStateHandler) => () => void;
  registerNavigate?: (
    handler: PendingFormNavigationNavigateHandler,
  ) => () => void;
};

declare global {
  interface Window {
    __herewovenPendingNavigation?: PendingFormNavigationBootstrap & {
      __earlyListener?: boolean;
    };
  }
}

/**
 * This runs in the document head before React/Next hydration. The pending
 * form controller registers its stateful handlers later, but these listeners
 * are already ahead of the router when a same-document traversal fires.
 * Keep this dependency-free: it is intentionally emitted as an inline head
 * script so it does not wait for a client bundle to load.
 */
export const PENDING_FORM_NAVIGATION_BOOTSTRAP_SCRIPT = `(function(){var k="__herewovenPendingNavigation",e=window[k];if(e&&e.__earlyListener)return;var h=[],n=[];var a={__earlyListener:true,register:function(f){h.push(f);var l=true;return function(){if(!l)return;l=false;var i=h.indexOf(f);if(i!==-1)h.splice(i,1)}},registerNavigate:function(f){n.push(f);var l=true;return function(){if(!l)return;l=false;var i=n.indexOf(f);if(i!==-1)n.splice(i,1)}}};window[k]=a;window.addEventListener("popstate",function(t){for(var i=h.length-1;i>=0;i-=1){var f=h[i];if(!f)continue;if(f(t)===true){t.preventDefault();t.stopImmediatePropagation();return}}},true);var v=window.navigation;if(v&&typeof v.addEventListener==="function"){v.addEventListener("navigate",function(t){if(!t||t.navigationType!=="traverse"||!t.cancelable||!t.destination||t.destination.sameDocument!==true)return;for(var i=n.length-1;i>=0;i-=1){var f=n[i];if(!f)continue;if(f(t)===true){t.preventDefault();if(typeof t.stopImmediatePropagation==="function")t.stopImmediatePropagation();return}}},true)}})()`;

export function getPendingFormNavigationBootstrap(): PendingFormNavigationBootstrap | null {
  if (typeof window === "undefined") return null;
  const bootstrap = window.__herewovenPendingNavigation;
  if (!bootstrap || typeof bootstrap.register !== "function") return null;
  return bootstrap;
}
