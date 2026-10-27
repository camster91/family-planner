"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { Sparkles, MessageSquareWarning } from "lucide-react";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useFeatures } from "@/components/providers/features-provider";
import { isFeatureEnabled } from "@/lib/features";
import { QuickAddDialog } from "@/components/layout/QuickAddDialog";
import { useCoreTranslation } from "@/i18n/core";
import {
  assistantShellMessages,
  type AssistantShellMessage,
} from "@/i18n/assistant-shell";

type AssistantPanelTab = "chat" | "report" | "reports";

function AssistantLoading() {
  const { t } = useCoreTranslation();
  const msg = (key: AssistantShellMessage) =>
    t(key, undefined, assistantShellMessages);
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {msg("loading")}
    </span>
  );
}

const AssistantPanel = dynamic(() => import("./AssistantPanel"), {
  ssr: false,
  loading: () => <AssistantLoading />,
});

const target =
  "min-h-[44px] rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-50";

/**
 * Dashboard launchers stay in the shell. The assistant forms, voice hook and
 * action clients are loaded only after a person opens one of these launchers,
 * keeping Today’s initial JavaScript small.
 */
export default function AssistantHost({
  role,
  todayContextEnabled = false,
  confirmationEnabled = false,
  profileAssignmentEnabled = false,
}: {
  role: string;
  todayContextEnabled?: boolean;
  confirmationEnabled?: boolean;
  profileAssignmentEnabled?: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { locale, t } = useCoreTranslation();
  const hydrated = useHydrated();
  const { features } = useFeatures();
  const msg = (key: AssistantShellMessage) =>
    hydrated || locale === "en"
      ? t(key, undefined, assistantShellMessages)
      : assistantShellMessages.en[key];
  const [tab, setTab] = React.useState<AssistantPanelTab | null>(null);
  const [panelLoaded, setPanelLoaded] = React.useState(false);
  const [panelBusy, setPanelBusy] = React.useState(false);
  const [quickAddOpen, setQuickAddOpen] = React.useState(false);
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
      setQuickAddOpen(false);
    }
  }, [hidden]);

  const open = React.useCallback(
    (next: AssistantPanelTab) => {
      if (panelBusy) return;
      setPanelLoaded(true);
      setTab(next);
    },
    [panelBusy],
  );
  const close = () => {
    if (panelBusy) return;
    setTab(null);
  };

  React.useEffect(() => {
    if (hidden) return;
    const openQuickAdd = () => {
      if (!panelBusy && canChat) setQuickAddOpen(true);
    };
    const openAssistant = () => {
      if (canChat) open("chat");
    };
    window.addEventListener("herewoven:quick-add", openQuickAdd);
    window.addEventListener("herewoven:assistant-open", openAssistant);
    return () => {
      window.removeEventListener("herewoven:quick-add", openQuickAdd);
      window.removeEventListener("herewoven:assistant-open", openAssistant);
    };
  }, [canChat, hidden, open, panelBusy]);

  if (hidden) return null;
  const shellLinks = {
    calendar: isFeatureEnabled(features, "calendar")
      ? "/dashboard/calendar"
      : null,
    chores: isFeatureEnabled(features, "chores") ? "/dashboard/chores" : null,
    lists: isFeatureEnabled(features, "lists") ? "/dashboard/lists" : null,
    meals: isFeatureEnabled(features, "meals") ? "/dashboard/meals" : null,
    notes: isFeatureEnabled(features, "notes") ? "/dashboard/notes" : null,
  };
  return (
    <>
      <div
        data-person-assistant
        data-launchers-suppressed={launcherSuppressed ? "true" : undefined}
        aria-hidden={launcherSuppressed ? "true" : undefined}
        className={`relative z-30 mx-auto flex w-full flex-wrap gap-2 px-4 py-3 pb-[calc(max(5rem,var(--phone-tab-bar-height,0px))+env(safe-area-inset-bottom,0px)+1rem)] transition-opacity motion-reduce:transition-none sm:px-6 lg:px-8 md:pb-6 max-[320px]:w-full max-[320px]:flex-nowrap max-[320px]:justify-end max-[320px]:border-t max-[320px]:border-[var(--surface-separator)] max-[320px]:bg-[var(--surface-grouped)] max-[320px]:px-4 max-[320px]:pt-2 ${launcherSuppressed ? "invisible pointer-events-none opacity-0" : ""}`}
      >
        {canChat && (
          <button
            type="button"
            tabIndex={launcherSuppressed ? -1 : undefined}
            onClick={() => setQuickAddOpen(true)}
            disabled={panelBusy}
            className={`${target} md:min-h-[56px] max-[320px]:h-11 max-[320px]:w-11 max-[320px]:shrink-0 max-[320px]:justify-center max-[320px]:gap-0 max-[320px]:px-0 max-[320px]:py-0 border border-[var(--surface-separator)] bg-[var(--surface-elevated)] text-label-primary shadow-lg inline-flex items-center gap-2`}
          >
            <Sparkles size={20} aria-hidden="true" />
            <span className="max-[320px]:sr-only">{msg("launcherAddAsk")}</span>
          </button>
        )}
        <button
          type="button"
          tabIndex={launcherSuppressed ? -1 : undefined}
          onClick={() => open("report")}
          disabled={panelBusy}
          className={`${target} md:min-h-[56px] max-[320px]:h-11 max-[320px]:w-11 max-[320px]:shrink-0 max-[320px]:justify-center max-[320px]:gap-0 max-[320px]:px-0 max-[320px]:py-0 border border-[var(--surface-separator)] bg-[var(--surface-elevated)] text-label-primary shadow-lg inline-flex items-center gap-2`}
        >
          <MessageSquareWarning size={20} aria-hidden="true" />
          <span className="max-[320px]:sr-only">{msg("launcherReport")}</span>
        </button>
      </div>
      <QuickAddDialog
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        role={role}
        links={shellLinks}
        captureHref={
          canChat && shellLinks.calendar
            ? "/dashboard/calendar?capture=1"
            : null
        }
        onAsk={canChat ? () => open("chat") : undefined}
      />
      {panelLoaded && (
        <AssistantPanel
          role={role}
          pathname={pathname}
          tab={tab}
          panelOpen={tab !== null}
          onTabChange={setTab}
          onClose={close}
          onBusyChange={setPanelBusy}
          todayContextEnabled={todayContextEnabled}
          confirmationEnabled={confirmationEnabled}
          profileAssignmentEnabled={profileAssignmentEnabled}
        />
      )}
    </>
  );
}
