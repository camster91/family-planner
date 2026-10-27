"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarPlus,
  Camera,
  CheckSquare,
  ListPlus,
  MessageCircle,
  NotebookPen,
  Utensils,
} from "lucide-react";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { Dialog } from "@/components/ui/dialog";
import { canCreateList } from "@/lib/role-capabilities";
import { canRoleAccessPath } from "@/lib/kid-access";
import { useTodayBoardText } from "@/i18n/today-board";

type QuickAddLinks = {
  calendar?: string | null;
  chores?: string | null;
  lists?: string | null;
  meals?: string | null;
  notes?: string | null;
};

export type QuickAddDialogProps = {
  open: boolean;
  onClose: () => void;
  role: string;
  links: QuickAddLinks;
  onAsk?: () => void;
  captureHref?: string | null;
};

const actionClass =
  "flex min-h-[52px] items-center gap-3 rounded-2xl border border-[var(--surface-separator)] bg-[var(--surface-fill)] px-4 py-3 text-left text-label-primary transition-colors hover:bg-[var(--surface-fill-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]";

/** One compact entry point for the common household actions. */
export function QuickAddDialog({
  open,
  onClose,
  role,
  links,
  onAsk,
  captureHref,
}: QuickAddDialogProps) {
  const text = useTodayBoardText();
  const router = useDraftAwareRouter();
  const canCreateEvent =
    (role === "parent" || role === "teen") &&
    Boolean(links.calendar) &&
    canRoleAccessPath(role, "/dashboard/calendar/create");
  const canCreateChore =
    role === "parent" &&
    Boolean(links.chores) &&
    canRoleAccessPath(role, "/dashboard/chores/create");
  const canAddList =
    canCreateList(role) &&
    Boolean(links.lists) &&
    canRoleAccessPath(role, "/dashboard/lists/create");
  const canUseMeals =
    Boolean(links.meals) && canRoleAccessPath(role, "/dashboard/meals");
  const canUseNotes =
    Boolean(links.notes) && canRoleAccessPath(role, "/dashboard/notes");

  const go = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    const href = event.currentTarget.getAttribute("href");
    if (!href) return;
    void router.push(href).then((navigated) => {
      if (navigated) onClose();
    });
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={text("quickAddTitle")}
      description={text("quickAddDescription")}
      closeLabel={text("closeQuickAdd")}
      testId="quick-add-dialog"
    >
      <div
        className="grid gap-2 sm:grid-cols-2"
        data-testid="quick-add-actions"
      >
        {onAsk && (role === "parent" || role === "teen") && (
          <button
            type="button"
            className="flex min-h-[52px] items-center gap-3 rounded-2xl px-4 py-3 text-left sm:col-span-2 bg-[var(--accent-fill)] text-white hover:bg-[var(--accent-fill-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
            onClick={() => {
              onClose();
              onAsk();
            }}
          >
            <MessageCircle size={21} aria-hidden="true" />
            <span>
              <span className="block font-semibold">{text("quickAsk")}</span>
              <span className="block text-sm opacity-85">
                {text("quickAskHint")}
              </span>
            </span>
          </button>
        )}
        {canCreateEvent && (
          <Link
            href="/dashboard/calendar/create"
            className={actionClass}
            onClick={go}
          >
            <CalendarPlus size={21} aria-hidden="true" />
            {text("addEvent")}
          </Link>
        )}
        {canCreateChore && (
          <Link
            href="/dashboard/chores/create"
            className={actionClass}
            onClick={go}
          >
            <CheckSquare size={21} aria-hidden="true" />
            {text("addChore")}
          </Link>
        )}
        {canAddList && (
          <Link
            href="/dashboard/lists/create"
            className={actionClass}
            onClick={go}
          >
            <ListPlus size={21} aria-hidden="true" />
            {text("addList")}
          </Link>
        )}
        {canUseMeals && (
          <Link href="/dashboard/meals" className={actionClass} onClick={go}>
            <Utensils size={21} aria-hidden="true" />
            {text("addMeal")}
          </Link>
        )}
        {canUseMeals && (
          <Link
            href="/dashboard/meals?view=bulk"
            className={actionClass}
            onClick={go}
          >
            <Utensils size={21} aria-hidden="true" />
            {text("addPrep")}
          </Link>
        )}
        {canUseNotes && (
          <Link href="/dashboard/notes" className={actionClass} onClick={go}>
            <NotebookPen size={21} aria-hidden="true" />
            {text("addNote")}
          </Link>
        )}
        {captureHref && canCreateEvent && (
          <Link href={captureHref} className={actionClass} onClick={go}>
            <Camera size={21} aria-hidden="true" />
            {text("importPhoto")}
          </Link>
        )}
        {!onAsk &&
          !canCreateEvent &&
          !canCreateChore &&
          !canAddList &&
          !canUseMeals &&
          !canUseNotes &&
          !captureHref && (
            <p
              role="status"
              className="col-span-full text-sm text-label-secondary"
            >
              {text("quickAddEmpty")}
            </p>
          )}
      </div>
    </Dialog>
  );
}
