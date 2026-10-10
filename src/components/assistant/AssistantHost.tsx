"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { Sparkles, MessageSquareWarning } from "lucide-react";

type AssistantPanelTab = "chat" | "report" | "reports";

const AssistantPanel = dynamic(() => import("./AssistantPanel"), {
  ssr: false,
  loading: () => (
    <span role="status" aria-live="polite" className="sr-only">
      Opening assistant…
    </span>
  ),
});

const target =
  "min-h-[44px] rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-50";

/**
 * Dashboard launchers stay in the shell. The assistant forms, voice hook and
 * action clients are loaded only after a person opens one of these launchers,
 * keeping Today’s initial JavaScript small.
 */
export default function AssistantHost({ role }: { role: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [tab, setTab] = React.useState<AssistantPanelTab | null>(null);
  const [panelLoaded, setPanelLoaded] = React.useState(false);
  const [panelBusy, setPanelBusy] = React.useState(false);
  const canChat = role === "parent" || role === "teen";
  const hidden =
    params.get("mode") === "fridge" || pathname.startsWith("/device");
  const [launcherSuppressed, setLauncherSuppressed] = React.useState(false);

  // The launchers stay in the document flow so they cannot cover dashboard
  // content, while a browser can still focus a form control near the bottom of
  // a long section. Temporarily tuck the launchers away while an editable
  // control outside this assistant panel is focused.
  // Keep the nodes mounted so dialog focus restoration and launcher state stay
  // intact when the control blurs.
  React.useEffect(() => {
    const isEditableControl = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target instanceof HTMLInputElement) {
        return ![
          "button",
          "checkbox",
          "file",
          "image",
          "radio",
          "reset",
          "submit",
        ].includes(target.type);
      }
      return (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.matches(
          "[contenteditable]:not([contenteditable='false']), [role='textbox']",
        )
      );
    };
    const isOutsideAssistant = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return !target.closest(
        "[data-person-assistant], [data-person-assistant-panel]",
      );
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isEditableControl(event.target) && isOutsideAssistant(event.target)) {
        setLauncherSuppressed(true);
      }
    };
    const onFocusOut = () => {
      queueMicrotask(() => {
        const active = document.activeElement;
        if (!isEditableControl(active) || !isOutsideAssistant(active)) {
          setLauncherSuppressed(false);
        }
      });
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  React.useEffect(() => {
    if (hidden) {
      setTab(null);
      setPanelBusy(false);
    }
  }, [hidden]);

  const open = (next: AssistantPanelTab) => {
    if (panelBusy) return;
    setPanelLoaded(true);
    setTab(next);
  };
  const close = () => {
    if (panelBusy) return;
    setTab(null);
  };

  if (hidden) return null;
  return (
    <>
      <div
        data-person-assistant
        data-launchers-suppressed={launcherSuppressed ? "true" : undefined}
        aria-hidden={launcherSuppressed ? "true" : undefined}
        className={`relative z-30 mx-auto flex w-full flex-wrap gap-2 px-4 py-3 pb-[calc(max(1rem,var(--phone-tab-bar-height,0px))+env(safe-area-inset-bottom,0px)+1rem)] transition-opacity motion-reduce:transition-none sm:px-6 lg:px-8 md:pb-6 max-[320px]:w-full max-[320px]:flex-nowrap max-[320px]:justify-end max-[320px]:border-t max-[320px]:border-[var(--surface-separator)] max-[320px]:bg-[var(--surface-grouped)] max-[320px]:px-4 max-[320px]:pt-2 ${launcherSuppressed ? "invisible pointer-events-none opacity-0" : ""}`}
      >
        <button
          type="button"
          tabIndex={launcherSuppressed ? -1 : undefined}
          onClick={() => open("report")}
          disabled={panelBusy}
          className={`${target} md:min-h-[56px] max-[320px]:h-11 max-[320px]:w-11 max-[320px]:shrink-0 max-[320px]:justify-center max-[320px]:gap-0 max-[320px]:px-0 max-[320px]:py-0 border border-[var(--surface-separator)] bg-[var(--surface-elevated)] text-label-primary shadow-lg inline-flex items-center gap-2`}
        >
          <MessageSquareWarning size={20} aria-hidden="true" />
          <span className="max-[320px]:sr-only">Report / Suggest</span>
        </button>
        {canChat && (
          <button
            type="button"
            tabIndex={launcherSuppressed ? -1 : undefined}
            onClick={() => open("chat")}
            disabled={panelBusy}
            className={`${target} md:min-h-[56px] max-[320px]:h-11 max-[320px]:w-11 max-[320px]:shrink-0 max-[320px]:justify-center max-[320px]:gap-0 max-[320px]:px-0 max-[320px]:py-0 bg-[var(--accent-fill)] text-white shadow-lg inline-flex items-center gap-2`}
          >
            <Sparkles size={20} aria-hidden="true" />
            <span className="max-[320px]:sr-only">AI assistant</span>
          </button>
        )}
      </div>
      {panelLoaded && (
        <AssistantPanel
          role={role}
          pathname={pathname}
          tab={tab}
          panelOpen={tab !== null}
          onTabChange={setTab}
          onClose={close}
          onBusyChange={setPanelBusy}
        />
      )}
    </>
  );
}
