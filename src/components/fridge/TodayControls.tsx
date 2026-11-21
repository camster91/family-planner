"use client";

import * as React from "react";
import { MoreHorizontal, Plus, RefreshCw } from "lucide-react";
import type { BoardLinks } from "@/app/dashboard/today/today-board-data";
import { canRoleAccessPath } from "@/lib/kid-access";
import { canCreateList } from "@/lib/role-capabilities";
import { useTodayBoardText } from "@/i18n/today-board";

// A quiet icon-only overflow (Calm Today): one primary button on the page.
const targetClass =
  "inline-flex h-11 w-11 items-center justify-center rounded-full text-label-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] active:bg-accent-tint";
/** One row of the Today overflow menu, at least 44px tall. */
export const todayMenuItemClass =
  "flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-label-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-text)] active:bg-accent-tint";

/**
 * The personal Today page's one primary button ("Add or ask") and a quiet
 * overflow menu for everything else: Customize, Fridge mode (large screens),
 * Refresh now. Navigation only: forms and household writes retain their
 * canonical authorization.
 */
export default function TodayControls({
  links,
  role,
  onRefresh,
  online,
  children,
}: {
  links: BoardLinks;
  role: string;
  onRefresh: () => void;
  online: boolean;
  children?: React.ReactNode;
}) {
  const text = useTodayBoardText();
  const details = React.useRef<HTMLDetailsElement>(null);
  const parent = role === "parent";
  const canCreateEvent = (parent || role === "teen") && Boolean(links.calendar);
  const canCreateChore = parent && Boolean(links.chores);
  const canAddList = canCreateList(role) && Boolean(links.lists);
  const canAddMeal =
    Boolean(links.meals) && canRoleAccessPath(role, "/dashboard/meals");
  const closeOnEscape = (event: React.KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== "Escape" || !event.currentTarget.open) return;
    if (
      event.target instanceof Element &&
      event.target.closest('[role="dialog"], [role="alertdialog"]')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
  };
  React.useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      // A child action may open a portalled dialog. Keep its opener visible
      // until that dialog closes so focus restoration remains reliable.
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="alertdialog"]')
      )
        return;
      for (const control of [details.current]) {
        if (control && !control.contains(event.target as Node))
          control.open = false;
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  return (
    <nav
      aria-label={text("todayQuickActions")}
      className="relative mb-4 flex items-center gap-2 md:mb-5"
    >
      {(canCreateEvent || canCreateChore || canAddList || canAddMeal) && (
        <button
          type="button"
          className="btn-primary inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
          aria-haspopup="dialog"
          data-primary-quick-add
          onClick={() => {
            if (details.current) details.current.open = false;
            window.dispatchEvent(new Event("herewoven:quick-add"));
          }}
        >
          <Plus size={18} aria-hidden="true" />
          {text("addOrAsk")}
        </button>
      )}
      <details
        ref={details}
        className="ml-auto"
        data-testid="today-overflow"
        onKeyDown={closeOnEscape}
      >
        <summary
          className={`${targetClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
        >
          <MoreHorizontal size={22} aria-hidden="true" />
          <span className="sr-only">{text("todayControls")}</span>
        </summary>
        <div className="absolute right-0 top-full z-20 mt-2 w-56 max-w-[calc(100vw-3rem)] rounded-2xl border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-2 shadow-xl">
          {children && <div className="mb-2 border-b border-[var(--surface-separator)] pb-2">{children}</div>}
          <button
            type="button"
            disabled={!online}
            className={`${todayMenuItemClass} disabled:opacity-50`}
            onClick={() => {
              if (details.current) details.current.open = false;
              details.current?.querySelector("summary")?.focus();
              onRefresh();
            }}
          >
            <RefreshCw size={18} aria-hidden="true" />
            {text("refreshNow")}
          </button>
          {!online && (
            <p className="px-3 text-xs text-label-secondary">
              {text("reconnectToRefresh")}
            </p>
          )}

        </div>
      </details>
    </nav>
  );
}
