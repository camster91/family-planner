"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { canRoleAccessPath } from "@/lib/kid-access";
import { isFeatureEnabled, type FamilyFeatures, type FeatureKey } from "@/lib/features";
import { useAssistantStartText, type AssistantStartMessage } from "@/i18n/assistant-start";
import AppGuide from "./AppGuide";

type Section = "help" | "today" | "add";
type Shortcut = {
  label: AssistantStartMessage;
  href: string;
  feature?: FeatureKey;
  parentOnly?: boolean;
};
const today: Shortcut[] = [
  { label: "today", href: "/dashboard/today" },
  { label: "calendar", href: "/dashboard/calendar", feature: "calendar" },
  { label: "chores", href: "/dashboard/chores", feature: "chores" },
  { label: "lists", href: "/dashboard/lists", feature: "lists" },
  { label: "meals", href: "/dashboard/meals", feature: "meals" },
  { label: "inventory", href: "/dashboard/inventory", feature: "inventory" },
];
const add: Shortcut[] = [
  { label: "event", href: "/dashboard/calendar/create", feature: "calendar" },
  { label: "chore", href: "/dashboard/chores/create", feature: "chores", parentOnly: true },
  { label: "list", href: "/dashboard/lists/create", feature: "lists" },
  { label: "recipes", href: "/dashboard/meals/explore", feature: "meals" },
  { label: "meals", href: "/dashboard/meals", feature: "meals" },
  { label: "prep", href: "/dashboard/meals?view=bulk", feature: "meals" },
  { label: "notes", href: "/dashboard/notes", feature: "notes" },
];

/** Navigation only: no household fetch, provider call, draft transfer or write. */
export function AssistantQuickStart({
  role, features, disabled, canNavigate, onNavigated, todayActions,
}: {
  role: string;
  features: FamilyFeatures;
  disabled: boolean;
  canNavigate: () => boolean;
  onNavigated: () => void;
  todayActions?: ReactNode;
}) {
  const [section, setSection] = useState<Section>("help");
  const text = useAssistantStartText();
  const router = useDraftAwareRouter();
  const knownRole = role === "parent" || role === "teen";
  const links = (section === "add" ? add : today).filter(link =>
    knownRole && (!link.parentOnly || role === "parent") &&
    (!link.feature || isFeatureEnabled(features, link.feature)) &&
    canRoleAccessPath(role, link.href.split(/[?#]/)[0]),
  );
  return (
    <section className="space-y-3" aria-label={text("sections")}>
      <div className="flex flex-wrap gap-1 rounded-2xl bg-surface-fill p-1">
        {(["help", "today", "add"] as const).map(key => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            aria-pressed={section === key}
            onClick={() => setSection(key)}
            className={`min-h-[44px] rounded-xl px-4 py-2 text-subhead font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-50 ${section === key ? "bg-[var(--surface-elevated)] text-label-primary" : "text-label-secondary"}`}
          >
            {text(key)}
          </button>
        ))}
      </div>
      {section === "help" ? (
        <AppGuide role={role} disabled={disabled} canNavigate={canNavigate} onNavigated={onNavigated} />
      ) : (
        <>
          <p className="text-footnote text-label-secondary">{text(section === "today" ? "todayHint" : "addHint")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {links.map(link => (
              <Link
                key={link.href}
                href={link.href}
                aria-disabled={disabled}
                tabIndex={disabled ? -1 : undefined}
                className="btn-tinted min-h-[44px] inline-flex items-center"
                onClick={event => {
                  if (disabled || !canNavigate()) {
                    event.preventDefault();
                    return;
                  }
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  void router.push(link.href).then(navigated => {
                    if (navigated) onNavigated();
                  });
                }}
              >
                {text(link.label)}
              </Link>
            ))}
          </div>
          {!links.length && <p role="status" className="text-footnote text-label-secondary">{text("empty")}</p>}
          {section === "today" && todayActions}
        </>
      )}
    </section>
  );
}
