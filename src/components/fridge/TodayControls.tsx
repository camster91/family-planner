"use client";

import * as React from "react";
import Link from "next/link";
import {
  Plus,
  CalendarPlus,
  ListPlus,
  ShoppingCart,
  Utensils,
  SlidersHorizontal,
  RefreshCw,
  Settings,
  LayoutGrid,
} from "lucide-react";
import type { BoardLinks } from "@/app/dashboard/today/today-board-data";
import { canRoleAccessPath } from "@/lib/kid-access";
import { canCreateList } from "@/lib/role-capabilities";
import ExplorePanel from "@/components/layout/ExplorePanel";
import { useTodayBoardText } from "@/i18n/today-board";

const targetClass =
  "inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-label-primary bg-[var(--surface-elevated)] border border-[var(--surface-separator)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] active:bg-accent-tint";
const menuClass =
  "flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-label-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-text)] active:bg-accent-tint";

/** Navigation only: forms and household writes retain their canonical authorization. */
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
  const add = React.useRef<HTMLDetailsElement>(null);
  const parent = role === "parent";
  const canCreateEvent = (parent || role === "teen") && Boolean(links.calendar);
  const canCreateChore = parent && Boolean(links.chores);
  const canAddList = canCreateList(role) && Boolean(links.lists);
  const closeOnEscape = (event: React.KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== "Escape" || !event.currentTarget.open) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
  };
  React.useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      for (const control of [details.current, add.current]) {
        if (control && !control.contains(event.target as Node)) control.open = false;
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  return (
    <nav
      aria-label={text("todayQuickActions")}
      className="relative mb-4 flex flex-wrap items-center gap-2 md:mb-5"
    >
      {(canCreateEvent || canCreateChore || canAddList) && (
        <details
          ref={add}
          className="relative"
          onKeyDown={closeOnEscape}
          onToggle={(event) => {
            if (event.currentTarget.open && details.current) details.current.open = false;
          }}
        >
          <summary className={`${targetClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
            <Plus size={18} aria-hidden="true" />
            {text("addAction")}
          </summary>
          <div className="absolute left-0 top-full z-20 mt-2 w-56 max-w-[calc(100vw-3rem)] rounded-2xl border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-2 shadow-xl">
            {canCreateEvent && (
              <Link prefetch={false} href="/dashboard/calendar/create" className={menuClass}>
                <CalendarPlus size={18} aria-hidden="true" />
                {text("addEvent")}
              </Link>
            )}
            {canCreateChore && (
              <Link prefetch={false} href="/dashboard/chores/create" className={menuClass}>
                <ListPlus size={18} aria-hidden="true" />
                {text("addChore")}
              </Link>
            )}
            {canAddList && (
              <Link prefetch={false} href="/dashboard/lists/create" className={menuClass}>
                <ListPlus size={18} aria-hidden="true" />
                {text("addList")}
              </Link>
            )}
          </div>
        </details>
      )}
      <ExplorePanel role={role} />
      <details
        ref={details}
        className="sm:relative"
        onKeyDown={closeOnEscape}
        onToggle={(event) => {
          if (event.currentTarget.open && add.current) add.current.open = false;
        }}
      >
        <summary
          className={`${targetClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          {text("todayControls")}
        </summary>
        <div className="absolute left-0 top-full z-20 mt-2 w-56 sm:left-auto sm:right-0 max-w-[calc(100vw-3rem)] rounded-2xl border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-2 shadow-xl">
          {links.lists && (
            <>
              <Link href="/dashboard/lists/groceries" className={menuClass}>
                <ShoppingCart size={18} aria-hidden="true" />
                {text("groceriesAction")}
              </Link>
              <Link href="/dashboard/lists" className={menuClass}>
                <LayoutGrid size={18} aria-hidden="true" />
                {text("allLists")}
              </Link>
            </>
          )}
          {links.meals && (
            <Link href={links.meals} className={menuClass}>
              <Utensils size={18} aria-hidden="true" />
              {text("planMeals")}
            </Link>
          )}
          <button
            type="button"
            disabled={!online}
            className={`${menuClass} disabled:opacity-50`}
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
          {parent && links.features && (
            <Link href={links.features} className={menuClass}>
              <LayoutGrid size={18} aria-hidden="true" />
              {text("householdFeatures")}
            </Link>
          )}
          {canRoleAccessPath(role, "/dashboard/settings") && (
            <Link href="/dashboard/settings" className={menuClass}>
              <Settings size={18} aria-hidden="true" />
              {text("mySettings")}
            </Link>
          )}
        </div>
      </details>
      {children}
    </nav>
  );
}
