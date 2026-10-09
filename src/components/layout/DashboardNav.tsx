"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-illustration";
import { PRODUCT_BRAND } from "@/lib/brand";
import { usePathname, useRouter } from "next/navigation";
import {
  Search,
  Bell,
  ChevronDown,
  Users2,
  Settings,
  LogOut,
  MessageCircle,
  LayoutDashboard,
  Refrigerator,
  Trash2,
  BellRing,
  CircleHelp,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import NotificationPreferences from "@/components/account/LazyNotificationPreferences";
import type { NavUser } from "@/types";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { TabBar } from "@/components/ui/tab-bar";
import { canRoleAccessPath, isKidRole } from "@/lib/kid-access";
import DeleteAccountDialog from "@/components/account/LazyDeleteAccountDialog";
import { clearAllPersonQueues } from "@/lib/offline-queue-browser";
import { useFeatures } from "@/components/providers/features-provider";
import { homeHrefFor, isTabActive, tabsFor } from "@/lib/nav-items";
import { isFeatureEnabled } from "@/lib/features";
import { useTranslation } from "@/i18n";
import {
  navigationMessages,
  navigationTabKey,
  type NavigationMessage,
} from "@/i18n/navigation";

interface DashboardNavProps {
  user: NavUser | null;
}

export default function DashboardNav({ user }: DashboardNavProps) {
  const { t } = useTranslation();
  const msg = (
    key: NavigationMessage,
    params?: Record<string, string | number>,
  ) => t(key, params, navigationMessages);
  const pathname = usePathname();
  const router = useRouter();
  const [avatarOpen, setAvatarOpen] = useState(false);
  // Children cannot open Settings (kid-access.ts), so their "Delete my
  // account" (D-3, ACCOUNT_DELETION.md) and their notification switches (#286)
  // live in this menu. Own account only. Teens use their own Settings (O-37).
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  // Hide links the role would only be redirected away from (src/lib/kid-access.ts).
  const canSee = (href: string) => canRoleAccessPath(user?.role, href);
  const { features } = useFeatures();
  // Same tabs as the phone tab bar (#269): Today · Calendar · Meals · Lists · Family.
  const primaryTabs = tabsFor(user?.role, features).map((tab) => {
    const key = navigationTabKey(tab.href);
    return key ? { ...tab, label: msg(key) } : tab;
  });
  const homeHref = homeHrefFor(user?.role);
  const isKid = isKidRole(user?.role);
  // A kid who cannot open Settings (a child) gets its personal controls here.
  const accountInMenu = isKid && !canSee("/dashboard/settings");
  // Food inventory (#263): feature-gated and on the kid allowlist, so every
  // role reaches it by touch from this menu (the command palette is
  // keyboard-only). Parents also find it under Family → More.
  const inventoryOn = isFeatureEnabled(features, "inventory");
  const messagesOn = isFeatureEnabled(features, "messages");

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!avatarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAvatarOpen(false);
      avatarButtonRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [avatarOpen]);

  const handleSignOut = async () => {
    try {
      // Offline changes belong to this session; sign-out drops them (#162).
      await clearAllPersonQueues();
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Offline or the request failed: still leave the signed-in UI. The
      // middleware sends a still-valid session straight back from /login.
    }
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      {/* ─── Apple HIG Desktop Top Bar ─── */}
      <nav
        aria-label={msg("mainNavigation")}
        className="bg-[var(--surface-elevated)] fixed top-0 left-0 right-0 z-50 h-16 border-b border-[var(--surface-separator)]"
      >
        <div className="max-w-7xl mx-auto h-full px-4 lg:px-8 flex items-center gap-3 lg:gap-6">
          {/* Logo + name */}
          {/* Keep the home name accessible even where the wordmark is hidden to leave room for actions. */}
          <Link
            href={homeHref}
            aria-label={msg("home", { brand: PRODUCT_BRAND.name })}
            className="flex min-h-[44px] items-center gap-2.5 shrink-0"
          >
            <BrandMark size={48} className="h-12 w-12" />
            <span className="font-display text-[20px] font-semibold tracking-tight text-label-primary hidden min-[390px]:block md:hidden lg:block lg:text-[22px]">
              {PRODUCT_BRAND.name}
            </span>
          </Link>

          {/* Primary tabs — md+ (the phone tab bar covers smaller widths).
              Icons from lg, where there is room for them. */}
          <div
            className="hidden md:flex items-center gap-1"
            data-testid="top-tabs"
          >
            {primaryTabs.map((tab) => {
              const isActive = isTabActive(tab, pathname);
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-[44px] items-center gap-1.5 px-3 rounded-full text-[15px] transition-colors duration-200",
                    isActive
                      ? "font-semibold text-accent bg-accent-fill/10"
                      : "font-medium text-label-secondary hover:text-label-primary hover:bg-[var(--surface-fill)]",
                  )}
                >
                  <Icon
                    className="hidden lg:block w-4 h-4"
                    strokeWidth={isActive ? 2.2 : 1.8}
                    aria-hidden="true"
                  />
                  {tab.label}
                </Link>
              );
            })}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right-side action cluster — md+ */}
          <div className="flex items-center gap-1">
            {/* Search */}
            {canSee("/dashboard/search") && (
              <Link
                href="/dashboard/search"
                className="inline-flex h-11 w-11 items-center justify-center text-label-secondary hover:text-label-primary rounded-full hover:bg-[var(--surface-fill)] transition-colors"
                aria-label={msg("search")}
              >
                <Search className="w-5 h-5" />
              </Link>
            )}

            {/* Notifications bell */}
            {canSee("/dashboard/notifications") && (
              <Link
                href="/dashboard/notifications"
                className="inline-flex h-11 w-11 items-center justify-center text-label-secondary hover:text-label-primary rounded-full hover:bg-[var(--surface-fill)] transition-colors relative"
                aria-label={msg("notifications")}
              >
                <Bell className="w-5 h-5" />
              </Link>
            )}

            {/* Avatar + overflow menu */}
            <div className="relative ml-1" ref={avatarRef}>
              <button
                ref={avatarButtonRef}
                onClick={() => setAvatarOpen((v) => !v)}
                className="flex min-h-[44px] items-center gap-1.5 p-1 pr-2.5 rounded-full hover:bg-[var(--surface-fill)] transition-colors"
                aria-label={msg("userMenu")}
                aria-expanded={avatarOpen}
              >
                <Avatar
                  name={user?.name ?? msg("user")}
                  src={user?.avatar_url}
                  size="sm"
                />
                <span className="hidden sm:block text-[14px] font-medium text-label-primary">
                  {user?.name?.split(" ")[0]}
                </span>
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 text-label-tertiary transition-transform duration-200",
                    avatarOpen && "rotate-180",
                  )}
                />
              </button>

              {/* Overflow dropdown */}
              {avatarOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 card-apple border border-[var(--surface-separator)] animate-spring-up">
                  {/* User info */}
                  <div className="px-4 py-3 border-b border-[var(--surface-separator)]">
                    <p className="text-[15px] font-semibold text-label-primary truncate">
                      {user?.name}
                    </p>
                    <span className="inline-block mt-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide bg-[var(--surface-fill)] text-label-secondary">
                      {msg(user?.role ?? "child")}
                    </span>
                  </div>

                  {/* Menu items */}
                  <div className="py-1.5">
                    {isKid && canSee("/dashboard/today") && (
                      <Link
                        href="/dashboard/today"
                        className="flex min-h-[44px] items-center gap-3 px-4 py-2.5 text-[15px] text-label-primary hover:bg-[var(--surface-fill)] transition-colors"
                        onClick={() => setAvatarOpen(false)}
                      >
                        <LayoutDashboard className="w-4 h-4 text-label-secondary" />
                        {msg("todayBoard")}
                      </Link>
                    )}
                    {inventoryOn && canSee("/dashboard/inventory") && (
                      <Link
                        href="/dashboard/inventory"
                        className="flex min-h-[44px] items-center gap-3 px-4 py-2.5 text-[15px] text-label-primary hover:bg-[var(--surface-fill)] transition-colors"
                        onClick={() => setAvatarOpen(false)}
                      >
                        <Refrigerator
                          className="w-4 h-4 text-label-secondary"
                          aria-hidden="true"
                        />
                        {msg("inventory")}
                      </Link>
                    )}
                    {messagesOn && canSee("/dashboard/messages") && (
                      <Link
                        href="/dashboard/messages"
                        className="flex min-h-[44px] items-center gap-3 px-4 py-2.5 text-[15px] text-label-primary hover:bg-[var(--surface-fill)] transition-colors"
                        onClick={() => setAvatarOpen(false)}
                      >
                        <MessageCircle className="w-4 h-4 text-label-secondary" />
                        {msg("messages")}
                      </Link>
                    )}
                    {canSee("/dashboard/family") && (
                      <Link
                        href="/dashboard/family"
                        className="flex min-h-[44px] items-center gap-3 px-4 py-2.5 text-[15px] text-label-primary hover:bg-[var(--surface-fill)] transition-colors"
                        onClick={() => setAvatarOpen(false)}
                      >
                        <Users2 className="w-4 h-4 text-label-secondary" />
                        {msg("family")}
                      </Link>
                    )}
                    {accountInMenu && (
                      <button
                        type="button"
                        onClick={() => {
                          setAvatarOpen(false);
                          setNotifyOpen(true);
                        }}
                        className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-label-primary hover:bg-[var(--surface-fill)] transition-colors"
                      >
                        <BellRing
                          className="w-4 h-4 text-label-secondary"
                          aria-hidden="true"
                        />
                        {msg("notifications")}
                      </button>
                    )}
                    {canSee("/dashboard/settings") && (
                      <Link
                        href="/dashboard/settings"
                        className="flex min-h-[44px] items-center gap-3 px-4 py-2.5 text-[15px] text-label-primary hover:bg-[var(--surface-fill)] transition-colors"
                        onClick={() => setAvatarOpen(false)}
                      >
                        <Settings className="w-4 h-4 text-label-secondary" />
                        {msg("settings")}
                      </Link>
                    )}
                    {/* Help (#146): parents and teens (O-37), like Settings. */}
                    {canSee("/dashboard/help") && (
                      <Link
                        href="/dashboard/help"
                        className="flex min-h-[44px] items-center gap-3 px-4 py-2.5 text-[15px] text-label-primary hover:bg-[var(--surface-fill)] transition-colors"
                        onClick={() => setAvatarOpen(false)}
                      >
                        <CircleHelp
                          className="w-4 h-4 text-label-secondary"
                          aria-hidden="true"
                        />
                        {msg("help")}
                      </Link>
                    )}
                  </div>

                  {/* Sign out */}
                  <div className="py-1.5 border-t border-[var(--surface-separator)]">
                    {accountInMenu && (
                      <button
                        type="button"
                        onClick={() => {
                          setAvatarOpen(false);
                          setDeleteOpen(true);
                        }}
                        className="flex min-h-[44px] items-center gap-3 px-4 py-2.5 w-full text-[15px] text-label-secondary hover:bg-[var(--surface-fill)] transition-colors"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                        {msg("deleteAccount")}
                      </button>
                    )}
                    <button
                      onClick={handleSignOut}
                      className="flex min-h-[44px] items-center gap-3 px-4 py-2.5 w-full text-[15px] text-danger-text hover:bg-[var(--danger-tint)] transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      {msg("signOut")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {accountInMenu && (
        <>
          <DeleteAccountDialog
            open={deleteOpen}
            onClose={() => {
              setDeleteOpen(false);
              avatarButtonRef.current?.focus();
            }}
            allowHousehold={false}
          />
          <Dialog
            open={notifyOpen}
            onClose={() => {
              setNotifyOpen(false);
              // The menu item that opened it is gone; return focus to the menu button.
              avatarButtonRef.current?.focus();
            }}
            title={msg("notifications")}
            description={msg("notificationDescription")}
            closeLabel={msg("close")}
            testId="notification-preferences-dialog"
          >
            <NotificationPreferences />
          </Dialog>
        </>
      )}

      {/* ─── Mobile bottom TabBar (handled inside layout, but exported here for reuse) ─── */}
      {/* The TabBar is rendered in layout.tsx, not here, to avoid double-rendering */}
    </>
  );
}

// Re-export TabBar so layout.tsx can import it from here
export { TabBar };
