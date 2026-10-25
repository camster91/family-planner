"use client";
import Link from "next/link";
import { PRODUCT_BRAND } from "@/lib/brand";
import { useDashboardFrameText } from "@/i18n/dashboard-frame";

/** Presentation only. Callers retain all server authentication/domain gates. */
export function SignedOutDashboard() {
  const text = useDashboardFrameText();
  return <div className="min-h-screen flex items-center justify-center"><div className="text-center">
    <h1 className="text-2xl font-bold text-foreground">{text("signedOutTitle")}</h1>
    <p className="mt-2 text-muted-foreground">{text("signedOutBody")}</p>
  </div></div>;
}
export function DashboardSkipLink() {
  const text = useDashboardFrameText();
  return <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-full focus:bg-[var(--tint-family)] focus:text-white focus:text-subhead focus:font-semibold focus:shadow-[var(--shadow-lg)]">{text("skipMain")}</a>;
}
export function DashboardMainLabel() {
  const text = useDashboardFrameText();
  return <span id="dashboard-main-label" className="sr-only">{text("mainLabel", { brand: PRODUCT_BRAND.name })}</span>;
}
export function HouseholdPageState({ page }: { page: "today" | "budget" | "activity" }) {
  const text = useDashboardFrameText();
  if (page === "budget") return <div className="text-center py-16">
    <h2 className="text-xl font-semibold text-foreground">{text("budgetTitle")}</h2>
    <p className="text-muted-foreground mt-2">{text("budgetHousehold")}</p>
  </div>;
  return <div className="mx-auto max-w-lg py-16 text-center">
    <h1 className="text-title-1 text-label-primary">{text(page === "today" ? "todayTitle" : "activityTitle")}</h1>
    <p className="mt-3 text-body text-label-secondary">{text(page === "today" ? "todayHousehold" : "activityHousehold")}</p>
    {page === "today" && <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
      <Link href="/dashboard" className="btn-filled">{text("createHousehold")}</Link>
      <Link href="/join" className="btn-plain">{text("joinCode")}</Link>
    </div>}
  </div>;
}
