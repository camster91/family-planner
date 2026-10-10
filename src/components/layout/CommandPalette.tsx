"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X, ChevronRight, Search } from "lucide-react";
import { SearchField } from "@/components/ui/search-field";
import { navItems } from "@/lib/nav-items";
import { useFeatures } from "@/components/providers/features-provider";
import { cn } from "@/lib/utils";
import { isFeatureEnabled } from "@/lib/features";
import { canRoleAccessPath } from "@/lib/kid-access";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Viewer's role: kids only see destinations on the kid allowlist. */
  role?: string | null;
}

export default function CommandPalette({
  open,
  onClose,
  role,
}: CommandPaletteProps) {
  const [query, setQuery] = React.useState("");
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { features } = useFeatures();

  React.useEffect(() => {
    if (!open) return;
    // Return focus to whatever opened the palette when it closes.
    const previous = document.activeElement as HTMLElement | null;
    setQuery("");
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      clearTimeout(timer);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Filter by both query and the family's enabled features.
  // Items without a featureKey are always visible (core surfaces). Effective
  // value: Rewards and Analytics also hide while Points & streaks is off (#248).
  const filteredNav = navItems.filter((item) => {
    if (!canRoleAccessPath(role, item.href)) return false;
    if (item.featureKey && !isFeatureEnabled(features, item.featureKey)) {
      return false;
    }
    return item.name.toLowerCase().includes(query.toLowerCase());
  });

  // Household search (route inventory F-3): hand the words to /dashboard/search.
  const searchWords = query.trim().replace(/\s+/g, " ");
  const offerSearch =
    searchWords.length >= 2 && canRoleAccessPath(role, "/dashboard/search");
  const searchHref = `/dashboard/search?q=${encodeURIComponent(searchWords)}`;

  const handleNavigate = (href: string) => {
    router.push(href);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[20vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[var(--surface-overlay)]"
        aria-hidden="true"
      />

      {/* Palette */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className={cn(
          "relative w-full max-w-lg mx-4",
          "card-elevated bg-[var(--surface-elevated)]",
          "overflow-hidden animate-spring-in",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--surface-separator)]">
          <Search
            className="w-5 h-5 text-label-tertiary shrink-0"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                offerSearch &&
                filteredNav.length === 0
              ) {
                e.preventDefault();
                handleNavigate(searchHref);
              }
            }}
            aria-label="Search or go to a page"
            placeholder="Search or type a command…"
            className="flex-1 text-body text-label-primary bg-transparent outline-none placeholder:text-label-tertiary"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="-my-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface-fill)]">
                <X
                  className="w-3.5 h-3.5 text-label-tertiary"
                  aria-hidden="true"
                />
              </span>
            </button>
          )}
          <kbd
            aria-hidden="true"
            className="text-caption-1 text-label-tertiary bg-[var(--surface-fill)] px-1.5 py-0.5 rounded shrink-0"
          >
            esc
          </kbd>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {offerSearch && (
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-2.5 min-h-[44px] text-left active:bg-[var(--surface-fill-secondary)]"
              onClick={() => handleNavigate(searchHref)}
            >
              <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--surface-fill)] flex items-center justify-center shrink-0">
                <Search
                  className="w-4 h-4 text-label-secondary"
                  aria-hidden="true"
                />
              </div>
              <span className="text-body text-label-primary flex-1 min-w-0 break-words">
                Search the household for &ldquo;{searchWords}&rdquo;
              </span>
              <ChevronRight
                className="w-4 h-4 text-label-tertiary shrink-0"
                aria-hidden="true"
              />
            </button>
          )}
          {/* Navigation shortcuts */}
          <div>
            <div className="section-header px-4 py-1">
              {query === "" ? "Go to" : "Results"}
            </div>
            {filteredNav.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.href}
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-[var(--surface-fill-secondary)]"
                  onClick={() => handleNavigate(item.href)}
                >
                  <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--surface-fill)] flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-label-secondary" />
                  </div>
                  <span className="text-body text-label-primary flex-1">
                    {item.name}
                  </span>
                  <ChevronRight className="w-4 h-4 text-label-tertiary shrink-0" />
                </button>
              );
            })}
            {filteredNav.length === 0 && query !== "" && !offerSearch && (
              <div className="px-4 py-6 text-center text-subhead text-label-tertiary">
                No results for &ldquo;{query}&rdquo;
              </div>
            )}
          </div>
        </div>

        {/* Footer hint */}
        {query === "" && (
          <div className="px-4 py-2.5 border-t border-[var(--surface-separator)] flex items-center gap-3">
            <kbd className="text-caption-2 text-label-tertiary bg-[var(--surface-fill)] px-1.5 py-0.5 rounded">
              ⌘K
            </kbd>
            <span className="text-caption-1 text-label-tertiary">
              to toggle
            </span>
            <div className="ml-auto flex items-center gap-1">
              <kbd className="text-caption-2 text-label-tertiary bg-[var(--surface-fill)] px-1.5 py-0.5 rounded">
                ↑↓
              </kbd>
              <span className="text-caption-1 text-label-tertiary">
                navigate
              </span>
              <kbd className="text-caption-2 text-label-tertiary bg-[var(--surface-fill)] px-1.5 py-0.5 rounded ml-1">
                ↵
              </kbd>
              <span className="text-caption-1 text-label-tertiary">select</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
